import { afterEach, beforeEach, expect, test } from 'bun:test';
import { ChangeMessageVisibilityCommand } from '@aws-sdk/client-sqs';
import {
  fixture,
  open,
  message,
  send,
  receive,
  drain,
} from '../messaging/helpers.js';
import {
  InboxEntity,
  LedgerEntity,
  OutboxEntity,
  TransactionEntity,
} from '../../src/adapters/persistence/entities.js';
import { call, cluster, reconcile, submit, until, stopAll } from './helpers.js';
import type { Child, Fixture } from './helpers.js';

let f: Fixture;
let children: Child[];
beforeEach(async () => {
  children = [];
  f = await fixture();
});
afterEach(async () => {
  try {
    await stopAll(children);
  } finally {
    await f?.close();
  }
});

async function expireAndKill(worker: Child) {
  const barrier = (await worker.wait('barrier'))!;
  expect(barrier.receipt).toBeString();
  await f.client.send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: f.urls.transactions,
      ReceiptHandle: barrier.receipt!,
      VisibilityTimeout: 1,
    }),
  );
  await worker.stop('SIGKILL');
  expect(worker.process.signalCode).toBe('SIGKILL');
}
async function deliveredExactlyOnce() {
  const stored = await f.orm.em.fork().find(OutboxEntity, {});
  await until(
    () => f.orm.em.fork().count(OutboxEntity, { publishedAt: null }),
    (n) => n === 0,
    'outbox drained',
  );
  const received = (await drain(f.client, f.urls.events)).map(
    (m) => (JSON.parse(m.Body!) as { eventId: string }).eventId,
  );
  expect(received.sort()).toEqual(stored.map((e) => e.id).sort());
}

test('SIGKILL before commit rolls back flushed effects and a fresh consumer completes after lease expiry', async () => {
  const w = await open(f),
    body = message(w);
  await send(f.client, f.urls.transactions, body);
  const [worker] = await cluster(f, children, 'consumer', 1, 'before-commit');
  worker!.start();
  await worker!.wait('barrier');
  expect(await f.orm.em.fork().count(InboxEntity, {})).toBe(0);
  expect(
    await f.orm.em.fork().count(TransactionEntity, {
      externalTransactionId: body.data.externalTransactionId,
    }),
  ).toBe(0);
  expect(await f.orm.em.fork().count(OutboxEntity, {})).toBe(2);
  await reconcile(f, w.id, '100.00');
  await expireAndKill(worker!);
  const [replacement] = await cluster(f, children, 'consumer', 1);
  replacement!.start();
  expect(await replacement!.wait('message_committed')).toMatchObject({
    idempotentReplay: false,
    status: 'PROCESSED',
  });
  expect(await f.orm.em.fork().count(InboxEntity, {})).toBe(1);
  expect(await f.orm.em.fork().count(LedgerEntity, { walletId: w.id })).toBe(2);
  expect(await receive(f.client, f.urls.transactions)).toBeUndefined();
  await reconcile(f, w.id, '75.00');
});

test('SIGKILL after commit before ack recovers with another consumer and two concurrent publisher processes', async () => {
  const w = await open(f),
    body = message(w);
  await send(f.client, f.urls.transactions, body);
  const [worker] = await cluster(f, children, 'consumer', 1, 'after-commit');
  worker!.start();
  await worker!.wait('barrier');
  expect(
    (
      await f.orm.em
        .fork()
        .findOneOrFail(InboxEntity, { messageId: body.messageId })
    ).processedAt,
  ).not.toBeNull();
  expect(await f.orm.em.fork().count(OutboxEntity, { publishedAt: null })).toBe(
    4,
  );
  await reconcile(f, w.id, '75.00');
  await expireAndKill(worker!);
  const [replacement] = await cluster(f, children, 'consumer', 1);
  replacement!.start();
  expect(await replacement!.wait('message_committed')).toMatchObject({
    idempotentReplay: true,
    status: 'PROCESSED',
  });
  const publishers = await cluster(
    f,
    children,
    'publisher',
    2,
    'before-publish',
  );
  publishers.forEach((p) => p.start());
  const claims = await Promise.all(publishers.map((p) => p.wait('barrier')));
  expect(new Set(claims.map((e) => e!.eventId)).size).toBe(2);
  expect(new Set(claims.map((e) => e!.dbPid)).size).toBe(2);
  expect(publishers.every((p) => p.process.exitCode === null)).toBe(true);
  publishers.forEach((p) => p.release());
  await deliveredExactlyOnce();
  expect(await f.orm.em.fork().count(LedgerEntity, { walletId: w.id })).toBe(2);
  expect(await receive(f.client, f.urls.transactions)).toBeUndefined();
  await reconcile(f, w.id, '75.00');
});

test('publisher SIGKILL after SQS send before SQL confirmation retries stable event IDs after restart', async () => {
  const w = await open(f);
  const [publisher] = await cluster(f, children, 'publisher', 1, 'after-send');
  publisher!.start();
  const claim = (await publisher!.wait('barrier'))!;
  await publisher!.stop('SIGKILL');
  expect(
    (await f.orm.em.fork().findOneOrFail(OutboxEntity, { id: claim.eventId! }))
      .publishedAt,
  ).toBeNull();
  const [replacement] = await cluster(f, children, 'publisher', 1);
  replacement!.start();
  await deliveredExactlyOnce();
  await reconcile(f, w.id, '100.00');
});

test.each(['REFUND', 'ROLLBACK'])(
  '%s before reference survives service restart and resolves once with a late BET',
  async (kind) => {
    const w = await open(f),
      bet = message(w);
    const reversal = message(w, {
      kind,
      referenceExternalTransactionId: bet.data.externalTransactionId,
    });
    const [original] = await cluster(
      f,
      children,
      'consumer',
      1,
      'after-commit',
    );
    original!.start();
    await send(f.client, f.urls.transactions, reversal);
    await original!.wait('barrier');
    await original!.stop();
    const pending = (await original!.wait('message_committed'))!;
    expect(pending.status).toBe('PENDING_REFERENCE');
    const [consumer] = await cluster(f, children, 'consumer', 1);
    const [references] = await cluster(f, children, 'references', 1);
    const [api] = await cluster(f, children, 'api', 1);
    const current = [consumer!, references!, api!];
    expect(new Set(current.map((c) => c.process.pid)).size).toBe(3);
    expect(
      current.every(
        (c) =>
          c.process.exitCode === null &&
          c.process.pid !== original!.process.pid,
      ),
    ).toBe(true);
    consumer!.start();
    references!.start();
    await send(f.client, f.urls.transactions, bet);
    await consumer!.wait('message_committed');
    await until(
      () =>
        references!.events.find(
          (e) => e.event === 'reference_attempt' && e.status === 'PROCESSED',
        ),
      (e) => !!e,
      'late reference processed',
    );
    const view = await call(
      api!,
      `/wagering/transactions/${pending.transactionId}`,
    );
    expect(view.status).toBe(200);
    expect(view.body.status).toBe('PROCESSED');
    const replay = await submit(api!, reversal);
    expect(replay.status).toBe(202);
    expect(replay.body).toMatchObject({
      transactionId: pending.transactionId,
      status: 'PENDING_REFERENCE',
      idempotentReplay: true,
    });
    await send(f.client, f.urls.transactions, reversal);
    await until(
      () =>
        consumer!.events.find(
          (e) =>
            e.event === 'message_committed' &&
            e.messageId === reversal.messageId,
        ),
      (e) => !!e,
      'replayed reversal after restart',
    );
    expect(await f.orm.em.fork().count(LedgerEntity, { walletId: w.id })).toBe(
      3,
    );
    await reconcile(f, w.id, '100.00');
  },
);
