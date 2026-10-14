import { beforeEach, afterEach, expect, test } from 'bun:test';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { fixture, open, message, send, publishAll } from './helpers.js';
import { sql, unique, transaction, ledger } from '../persistence/helpers.js';
import { Telemetry } from '../../src/adapters/observability/telemetry.js';
import { Operations } from '../../src/adapters/observability/operations.js';
import { createApplication } from '../../src/composition/bootstrap.js';
import { DatabaseHttpServices } from '../../src/composition/http-services.js';
import { loadConfig } from '../../src/adapters/config/environment.js';
import { createFinancialProcessing } from '../../src/composition/financial-processing.js';
import { parseWagerMessage } from '../../src/adapters/messaging/request-contract.js';
import { SqsConsumer } from '../../src/adapters/messaging/sqs-consumer.js';
import { PublishOutbox } from '../../src/application/publish-outbox.js';
import { MikroOutboxUnitOfWork } from '../../src/adapters/persistence/outbox-unit-of-work.js';
import { SqsEventPublisher } from '../../src/adapters/messaging/sqs-event-publisher.js';
import { financialRuntime } from '../../src/adapters/runtime/financial-runtime.js';
import { runReferenceWorker } from '../../src/adapters/workers/reference-worker.js';
import { startWorkerServer } from '../../src/adapters/observability/worker-server.js';
let f: Awaited<ReturnType<typeof fixture>>;
let telemetry: Telemetry,
  operations: Operations,
  app: Awaited<ReturnType<typeof createApplication>>,
  url: string;
let lines: string[];
beforeEach(async () => {
  f = await fixture();
  lines = [];
  telemetry = new Telemetry((line) => lines.push(line));
  const config = {
    ...loadConfig(process.env),
    database: { ...loadConfig(process.env).database, name: f.name },
  };
  operations = new Operations(config, telemetry, f.names);
  app = await createApplication(
    true,
    new DatabaseHttpServices(config.database, telemetry),
    operations,
  );
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
afterEach(async () => {
  await app?.close();
  await f?.close();
});
async function post(
  path: string,
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}
async function metrics() {
  const r = await fetch(`${url}/metrics`);
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toContain('text/plain');
  return r.text();
}
async function corruptBalance(id: string, value: string) {
  await f.orm.em.fork().transactional(async (em) => {
    await sql(em, "set local session_replication_role='replica'");
    await sql(em, 'update wallets set balance=? where id=?', [value, id]);
  });
}

test('reconciliation HTTP covers empty ledger, precise large balances, missing wallet and signed divergences without repair', async () => {
  const empty = await f.service.createWallet(
    { playerId: unique(), initialBalance: { amount: '0.00', currency: 'BRL' } },
    { correlationId: unique() },
  );
  const zero = await post(`/wallets/${empty.id}/reconciliation`);
  expect(zero.response.status).toBe(200);
  expect(zero.body).toMatchObject({
    consistent: true,
    checkedEntries: 0,
    difference: { amount: '0.00', currency: 'BRL' },
  });
  const amount = '999999999999999999999999999999999999.98';
  const w = await f.service.createWallet(
    { playerId: unique(), initialBalance: { amount, currency: 'BRL' } },
    { correlationId: unique() },
  );
  expect(
    (await post(`/wallets/${w.id}/reconciliation`)).body.storedBalance.amount,
  ).toBe(amount);
  try {
    for (const [value, difference] of [
      ['999999999999999999999999999999999999.99', '0.01'],
      ['999999999999999999999999999999999999.97', '-0.01'],
    ]) {
      await corruptBalance(w.id, value!);
      const r = await post(
        `/wallets/${w.id}/reconciliation`,
        {},
        { 'X-Correlation-Id': 'reconcile-correlation' },
      );
      expect(r.response.status).toBe(200);
      expect(r.body).toMatchObject({
        walletId: w.id,
        storedBalance: { amount: value, currency: 'BRL' },
        calculatedBalance: { amount, currency: 'BRL' },
        difference: { amount: difference, currency: 'BRL' },
        checkedEntries: 1,
        consistent: false,
      });
      expect(
        await sql(
          f.orm.em.fork(),
          'select balance::text from wallets where id=?',
          [w.id],
        ),
      ).toEqual([{ balance: value }]);
    }
    const logs = lines
      .map((line) => JSON.parse(line))
      .filter((e) => e.event === 'reconciliation_divergence');
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({
      walletId: w.id,
      correlationId: 'reconcile-correlation',
      level: 'error',
    });
    expect(lines.join('')).not.toContain(amount);
    expect(await metrics()).toContain(
      'wagering_reconciliations_total{consistent="false"} 2',
    );
  } finally {
    await corruptBalance(w.id, amount);
  }
  expect(
    (await post(`/wallets/${unique()}/reconciliation`)).response.status,
  ).toBe(404);
});

test('one SQL reconciliation snapshot never observes half of a concurrent financial commit', async () => {
  const w = await open(f),
    em = f.orm.em.fork();
  await em.begin();
  try {
    const tx = await transaction(em, {
      walletId: w.id,
      kind: 'BET',
      status: 'PROCESSED',
      amount: '25.00',
    });
    await sql(
      em,
      'update wallets set balance=75,version=2,updated_at=clock_timestamp() where id=?',
      [w.id],
    );
    await ledger(em, {
      walletId: w.id,
      transactionId: tx,
      amount: '25.00',
      before: '100.00',
      after: '75.00',
      version: 2,
      direction: 'DEBIT',
    });
    const before = await post(`/wallets/${w.id}/reconciliation`);
    expect(before.body).toMatchObject({
      consistent: true,
      storedBalance: { amount: '100.00' },
      calculatedBalance: { amount: '100.00' },
      checkedEntries: 1,
    });
    await em.commit();
  } catch (error) {
    await em.rollback();
    throw error;
  }
  expect((await post(`/wallets/${w.id}/reconciliation`)).body).toMatchObject({
    consistent: true,
    storedBalance: { amount: '75.00' },
    calculatedBalance: { amount: '75.00' },
    checkedEntries: 2,
  });
});

test('HTTP outcome, replay, latency and persisted status metrics carry safe correlation and no financial payload', async () => {
  const w = await open(f),
    request = message(w);
  const { idempotencyKey, ...body } = request.data;
  const headers = {
    'Idempotency-Key': idempotencyKey,
    'X-Correlation-Id': 'http-correlation',
  };
  const first = await post('/wagering/transactions', body, headers);
  expect(first.response.headers.get('x-correlation-id')).toBe(
    'http-correlation',
  );
  expect(first.response.status).toBe(201);
  expect(
    (await post('/wagering/transactions', body, headers)).body.idempotentReplay,
  ).toBe(true);
  const rejected = message(w, {
    money: { amount: '999.00', currency: 'BRL' },
  }).data;
  const { idempotencyKey: rejectKey, ...rejectBody } = rejected;
  expect(
    (
      await post('/wagering/transactions', rejectBody, {
        'Idempotency-Key': rejectKey,
      })
    ).response.status,
  ).toBe(422);
  const pending = message(w, {
    kind: 'REFUND',
    referenceExternalTransactionId: unique(),
  }).data;
  const { idempotencyKey: pendingKey, ...pendingBody } = pending;
  expect(
    (
      await post('/wagering/transactions', pendingBody, {
        'Idempotency-Key': pendingKey,
      })
    ).response.status,
  ).toBe(202);
  const text = await metrics();
  expect(text).toContain(
    'wagering_processing_results_total{source="http",status="PROCESSED"} 1',
  );
  expect(text).toContain(
    'wagering_processing_results_total{source="http",status="REJECTED"} 1',
  );
  expect(text).toContain(
    'wagering_processing_results_total{source="http",status="PENDING_REFERENCE"} 1',
  );
  expect(text).toContain('wagering_duplicates_total{source="http"} 1');
  expect(text).toContain(
    'wagering_processing_duration_seconds_count{source="http"} 4',
  );
  expect(text).toContain('wagering_transactions{status="PROCESSED"} 2');
  const log = lines
    .map((line) => JSON.parse(line))
    .find((e) => e.event === 'transaction_committed');
  expect(log).toMatchObject({
    correlationId: 'http-correlation',
    transactionId: first.body.transactionId,
    walletId: w.id,
    providerId: 'provider',
    messageId: null,
  });
  for (const secret of [
    idempotencyKey,
    '25.00',
    '999.00',
    'initialBalance',
    'payloadHash',
    'playerId',
  ])
    expect(lines.join('')).not.toContain(secret);
  expect(text).not.toContain(w.id);
});

test('SQS replay, retry, DLQ, publisher lag and reference retries are observable with real dependencies', async () => {
  const w = await open(f),
    body = message(w);
  const processing = createFinancialProcessing(f.orm, telemetry);
  const consumer = new SqsConsumer(
    f.client,
    f.urls,
    processing,
    telemetry.report,
  );
  await send(f.client, f.urls.transactions, body);
  await consumer.once(new AbortController().signal);
  await send(f.client, f.urls.transactions, body);
  await consumer.once(new AbortController().signal);
  await send(f.client, f.urls.transactions, 'invalid-json');
  await consumer.once(new AbortController().signal);
  const failureBody = message(w);
  await send(f.client, f.urls.transactions, failureBody);
  await new SqsConsumer(
    f.client,
    f.urls,
    {
      process: async () => {
        throw new Error('infrastructure');
      },
    },
    telemetry.report,
  ).once(new AbortController().signal);
  const pending = message(w, {
    kind: 'REFUND',
    referenceExternalTransactionId: unique(),
  }).data;
  await processing.process(
    parseWagerMessage(
      JSON.stringify({
        messageId: unique(),
        type: 'WagerTransactionRequested',
        occurredAt: new Date().toISOString(),
        data: pending,
      }),
    ).command,
    { correlationId: 'reference-correlation' },
  );
  await Bun.sleep(1100);
  await runReferenceWorker(
    () => processing.retryReference(),
    new AbortController().signal,
    telemetry.report,
    true,
  );
  const failedPublisher = new PublishOutbox(
    new MikroOutboxUnitOfWork(f.orm),
    new SqsEventPublisher(f.client, `${f.urls.events}-missing`),
    financialRuntime,
  );
  telemetry.report({
    event: 'outbox_attempt',
    ...(await telemetry.observe('outbox', {}, () => failedPublisher.once())),
  });
  const text = await metrics();
  for (const expected of [
    'wagering_duplicates_total{source="sqs"} 1',
    'wagering_retries_total{source="sqs"} 1',
    'wagering_dead_letters_total 1',
    'wagering_retries_total{source="outbox"} 1',
    'wagering_retries_total{source="reference"} 1',
    'wagering_dlq_messages{state="visible"} 1',
  ])
    expect(text).toContain(expected);
  expect(
    Number(text.match(/^wagering_outbox_lag_seconds (.+)$/m)![1]),
  ).toBeGreaterThan(0);
  expect(lines.map((line) => JSON.parse(line))).toContainEqual(
    expect.objectContaining({
      event: 'message_committed',
      correlationId: body.messageId,
      messageId: body.messageId,
      transactionId: expect.any(String),
      walletId: w.id,
      providerId: 'provider',
    }),
  );
  await Bun.sleep(1100);
  await publishAll(f);
  expect(await metrics()).toContain('wagering_outbox_lag_seconds 0');
});

async function unusedPort() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}
test.each(['postgres', 'sqs'])(
  'readiness detects refused %s while public liveness works and failed metrics do not claim zero',
  async (dependency) => {
    const config = {
      ...loadConfig(process.env),
      database: { ...loadConfig(process.env).database, name: f.name },
    };
    const port = await unusedPort();
    if (dependency === 'postgres')
      config.database = { ...config.database, host: '127.0.0.1', port };
    else config.sqs = { ...config.sqs, endpoint: `http://127.0.0.1:${port}` };
    const failed = new Operations(config, telemetry, f.names);
    const server = await createApplication(true, undefined, failed);
    await server.listen(0, '127.0.0.1');
    try {
      const origin = await server.getUrl();
      const ready = await fetch(`${origin}/health/ready`);
      expect(ready.status).toBe(503);
      expect((await ready.json()).checks).toEqual({
        postgres: dependency === 'postgres' ? 'down' : 'up',
        sqs: dependency === 'sqs' ? 'down' : 'up',
      });
      expect((await fetch(`${origin}/health/live`)).status).toBe(200);
      expect((await fetch(`${origin}/metrics`)).status).toBe(503);
    } finally {
      await server.close();
    }
  },
);

test('public readiness succeeds and worker exposes metrics on its own HTTP listener', async () => {
  const r = await fetch(`${url}/health/ready`);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({
    status: 'ready',
    checks: { postgres: 'up', sqs: 'up' },
  });
  const server = startWorkerServer(operations, '127.0.0.1', 0);
  try {
    expect(
      (await fetch(`http://127.0.0.1:${server.port}/metrics`)).status,
    ).toBe(200);
    expect(
      (await fetch(`http://127.0.0.1:${server.port}/health/ready`)).status,
    ).toBe(200);
  } finally {
    await server.stop();
  }
});

test.each(['sqs', 'postgres'])(
  'a reachable but stalled %s endpoint fails within the configured request deadline',
  async (dependency) => {
    const sockets = new Set<Socket>();
    const stalled = createServer(() => {});
    stalled.on('connection', (s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    await new Promise<void>((r) => stalled.listen(0, '127.0.0.1', r));
    const port = (stalled.address() as { port: number }).port;
    const config = loadConfig(process.env);
    const probe = new Operations(
      {
        ...config,
        database: {
          ...config.database,
          name: f.name,
          ...(dependency === 'postgres' ? { host: '127.0.0.1', port } : {}),
        },
        sqs:
          dependency === 'sqs'
            ? { ...config.sqs, endpoint: `http://127.0.0.1:${port}` }
            : config.sqs,
      },
      telemetry,
      f.names,
    );
    try {
      const start = performance.now();
      expect(
        (await probe.ready()).checks[dependency as 'sqs' | 'postgres'],
      ).toBe('down');
      expect(performance.now() - start).toBeLessThan(5000);
    } finally {
      await probe.onApplicationShutdown();
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => stalled.close(() => r()));
    }
  },
);

test('a real PostgreSQL lock timeout increments conflicts and failed latency without exposing SQL', async () => {
  const w = await open(f),
    body = message(w);
  const control = f.orm.em.fork();
  await control.begin();
  try {
    await sql(control, 'select 1 from wallets where id=? for update', [w.id]);
    const consumer = new SqsConsumer(
      f.client,
      f.urls,
      createFinancialProcessing(f.orm, telemetry),
      telemetry.report,
    );
    await send(f.client, f.urls.transactions, body);
    await consumer.once(new AbortController().signal);
    expect(await metrics()).toContain(
      'wagering_lock_conflicts_total{source="sqs",code="55P03"} 1',
    );
    expect(await metrics()).toContain(
      'wagering_processing_duration_seconds_count{source="sqs"} 1',
    );
    expect(lines.join('')).not.toContain('select');
  } finally {
    await control.rollback();
  }
});
