import { WagerTransactionStatus } from '../../src/domain/wager-transaction.js';
import { beforeEach, afterEach, expect, test } from 'bun:test';
import { fixture, open, message, send, drain, publishAll } from './helpers.js';
import { PublishOutbox } from '../../src/application/publish-outbox.js';
import {
  MikroOutboxSession,
  MikroOutboxUnitOfWork,
} from '../../src/adapters/persistence/outbox-unit-of-work.js';
import { SqsEventPublisher } from '../../src/adapters/messaging/sqs-event-publisher.js';
import {
  OutboxEntity,
  TransactionEntity,
} from '../../src/adapters/persistence/entities.js';
import { financialRuntime } from '../../src/adapters/runtime/financial-runtime.js';
import { FinancialProcessing } from '../../src/application/financial-processing.js';
import {
  MikroFinancialSession,
  MikroFinancialUnitOfWork,
} from '../../src/adapters/persistence/financial-unit-of-work.js';
import { parseWagerMessage } from '../../src/adapters/messaging/request-contract.js';
import { sql, unique } from '../persistence/helpers.js';
let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
});
afterEach(async () => {
  await f?.close();
});

test('publisher emits stored envelopes after financial commit and marks them published', async () => {
  const w = await open(f);
  await send(f.client, f.urls.transactions, message(w));
  await f.consumer.once(new AbortController().signal);
  const rows = await f.orm.em.fork().find(OutboxEntity, {});
  expect(rows).toHaveLength(4);
  await publishAll(f);
  const delivered = await drain(f.client, f.urls.events);
  expect(delivered).toHaveLength(4);
  expect(delivered.map((m) => JSON.parse(m.Body!).eventId).sort()).toEqual(
    rows.map((r) => r.id).sort(),
  );
  expect(await f.orm.em.fork().count(OutboxEntity, { publishedAt: null })).toBe(
    0,
  );
  expect(await f.publisher.once()).toBeUndefined();
  for (const item of delivered)
    expect(
      rows.find((r) => r.id === JSON.parse(item.Body!).eventId)!.payload,
    ).toEqual(JSON.parse(item.Body!));
});

test('uncommitted financial outbox is invisible to publishers, then published after commit', async () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  const service = new FinancialProcessing(
    {
      run: (work) =>
        f.orm.em.fork().transactional(async (em) => {
          const result = await work(new MikroFinancialSession(em));
          await em.flush();
          entered();
          await gate;
          return result;
        }),
    },
    financialRuntime,
  );
  const opening = service.createWallet(
    {
      playerId: unique(),
      initialBalance: { amount: '100.00', currency: 'BRL' },
    },
    { correlationId: unique() },
  );
  try {
    await started;
    expect(await f.publisher.once()).toBeUndefined();
    expect(await drain(f.client, f.urls.events)).toHaveLength(0);
  } finally {
    release();
    await opening;
  }
  await publishAll(f);
  expect(await drain(f.client, f.urls.events)).toHaveLength(2);
});

test('two publishers hold different outbox row locks concurrently and drain without duplicate IDs', async () => {
  await open(f);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const ids = new Set<string>();
  const pids = new Set<number>();
  const publisher = new SqsEventPublisher(f.client, f.urls.events);
  const worker = new PublishOutbox(
    {
      run: (work) =>
        f.orm.em.fork().transactional(async (em) => {
          const [{ pid }] = (await sql(
            em,
            'select pg_backend_pid() as pid',
          )) as [{ pid: number }];
          pids.add(pid);
          return work(new MikroOutboxSession(em));
        }),
    },
    {
      publish: async (msg) => {
        ids.add(msg.id);
        if (ids.size === 2) release();
        await gate;
        await publisher.publish(msg);
      },
    },
    financialRuntime,
  );
  await Promise.all([worker.once(), worker.once()]);
  expect(ids.size).toBe(2);
  expect(pids.size).toBe(2);
  expect(await drain(f.client, f.urls.events)).toHaveLength(2);
  expect(await f.publisher.once()).toBeUndefined();
});

test('publisher failure persists backoff and another instance resumes the same event', async () => {
  await open(f);
  const now = financialRuntime.now();
  const broken = new PublishOutbox(
    new MikroOutboxUnitOfWork(f.orm),
    new SqsEventPublisher(f.client, f.urls.events + '-missing'),
    { ...financialRuntime, now: () => now },
  );
  const result = await broken.once();
  expect(result!.status).toBe('retry');
  const row = await f.orm.em
    .fork()
    .findOneOrFail(OutboxEntity, { id: result!.eventId });
  expect(row.attempts).toBe(1);
  expect(row.publishedAt).toBeNull();
  expect(row.nextAttemptAt!.getTime()).toBe(Date.parse(now) + 1000);
  await f.publisher.once();
  expect(await drain(f.client, f.urls.events)).toHaveLength(1);
  expect(await f.publisher.once()).toBeUndefined();
  const resumed = new PublishOutbox(
    new MikroOutboxUnitOfWork(f.orm),
    new SqsEventPublisher(f.client, f.urls.events),
    {
      ...financialRuntime,
      now: () => new Date(Date.parse(now) + 1000).toISOString(),
    },
  );
  expect((await resumed.once())!.eventId).toBe(row.id);
  expect(await drain(f.client, f.urls.events)).toHaveLength(1);
});

test('send success followed by failed SQL commit is recoverable with stable event ID', async () => {
  await open(f);
  const worker = new PublishOutbox(
    {
      run: (work) =>
        f.orm.em.fork().transactional(async (em) => {
          await work(new MikroOutboxSession(em));
          await em.flush();
          throw new Error('after broker accepted');
        }),
    },
    new SqsEventPublisher(f.client, f.urls.events),
    financialRuntime,
  );
  await expect(worker.once()).rejects.toThrow('after broker accepted');
  const first = await drain(f.client, f.urls.events);
  expect(first).toHaveLength(1);
  const id = JSON.parse(first[0]!.Body!).eventId as string;
  expect(
    (await f.orm.em.fork().findOneOrFail(OutboxEntity, { id })).publishedAt,
  ).toBeNull();
  await publishAll(f);
  expect(
    (await f.orm.em.fork().findOneOrFail(OutboxEntity, { id })).publishedAt,
  ).not.toBeNull();
  const rest = await drain(f.client, f.urls.events);
  expect(rest.map((m) => JSON.parse(m.Body!).eventId)).not.toContain(id);
  expect(rest).toHaveLength(1);
});

test('reference expiry event from T06 reaches the broker', async () => {
  let now = '2026-10-14T00:00:00.000Z';
  const service = new FinancialProcessing(new MikroFinancialUnitOfWork(f.orm), {
    ...financialRuntime,
    now: () => now,
  });
  const w = await service.createWallet(
    {
      playerId: unique(),
      initialBalance: { amount: '100.00', currency: 'BRL' },
    },
    { correlationId: unique() },
  );
  const body = message(w, {
    kind: 'REFUND',
    referenceExternalTransactionId: unique(),
  });
  const parsed = parseWagerMessage(JSON.stringify(body));
  const pending = await service.process(
    parsed.command,
    parsed.context,
    parsed.delivery,
  );
  now = '2026-10-15T00:00:00.000Z';
  await service.retryReference();
  const publisher = new PublishOutbox(
    new MikroOutboxUnitOfWork(f.orm),
    new SqsEventPublisher(f.client, f.urls.events),
    { ...financialRuntime, now: () => now },
  );
  while (await publisher.once()) {
    /* drain due events */
  }
  const events = (await drain(f.client, f.urls.events)).map((m) =>
    JSON.parse(m.Body!),
  );
  expect(
    events.find((e) => e.eventType === 'WagerTransactionRejected'),
  ).toMatchObject({
    data: {
      transactionId: pending.transactionId,
      failureCode: 'REFERENCE_NOT_FOUND',
    },
  });
  expect(
    (
      await f.orm.em
        .fork()
        .findOneOrFail(TransactionEntity, { id: pending.transactionId })
    ).status,
  ).toBe(WagerTransactionStatus.Rejected);
});
