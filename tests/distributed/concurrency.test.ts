import { afterEach, beforeEach, expect, test } from 'bun:test';
import { fixture, open, message, send, receive } from '../messaging/helpers.js';
import {
  InboxEntity,
  LedgerEntity,
} from '../../src/adapters/persistence/entities.js';
import {
  blockedBy,
  call,
  cluster,
  holdWallet,
  reconcile,
  submit,
  stopAll,
  until,
} from './helpers.js';
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

test('50 parallel HTTP bets across three live processes debit once and survive API restart', async () => {
  const w = await open(f),
    body = message(w);
  const apis = await cluster(f, children, 'api', 3);
  const hold = await holdWallet(f, w.id);
  const pending = Promise.allSettled(
    Array.from({ length: 50 }, (_, i) => submit(apis[i % 3]!, body)),
  );
  try {
    await blockedBy(
      f,
      hold.pid,
      await Promise.all(apis.map(async (a) => (await a.ready)!.dbPid!)),
    );
  } finally {
    await hold.release();
  }
  const results = (await pending).map((r) => {
    if (r.status === 'rejected') throw r.reason;
    return r.value;
  });
  expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  expect(
    results.filter((r) => r.status === 200 && r.body.idempotentReplay === true),
  ).toHaveLength(49);
  expect(new Set(results.map((r) => r.body.transactionId)).size).toBe(1);
  expect(await f.orm.em.fork().count(LedgerEntity, { walletId: w.id })).toBe(2);
  await Promise.all(apis.map((a) => a.stop()));
  const [restarted] = await cluster(f, children, 'api', 1);
  expect(apis.map((a) => a.process.pid)).not.toContain(restarted!.process.pid);
  const replay = await submit(restarted!, body);
  expect(replay.status).toBe(200);
  expect(replay.body).toMatchObject({
    transactionId: results[0]!.body.transactionId,
    idempotentReplay: true,
    balance: { amount: '75.00', currency: 'BRL' },
  });
  await reconcile(f, w.id, '75.00');
});

test('two independent processes race for 80 of 100 while a third wallet operation progresses', async () => {
  const w = await open(f),
    other = await open(f);
  const apis = await cluster(f, children, 'api', 3);
  const hold = await holdWallet(f, w.id);
  const bodies = [
    message(w, { money: { amount: '80.00', currency: 'BRL' } }),
    message(w, { money: { amount: '80.00', currency: 'BRL' } }),
  ];
  const pending = Promise.allSettled(bodies.map((b, i) => submit(apis[i]!, b)));
  try {
    await blockedBy(
      f,
      hold.pid,
      await Promise.all(
        apis.slice(0, 2).map(async (a) => (await a.ready)!.dbPid!),
      ),
    );
    expect((await submit(apis[2]!, message(other))).status).toBe(201);
    await reconcile(f, other.id, '75.00');
    await blockedBy(
      f,
      hold.pid,
      await Promise.all(
        apis.slice(0, 2).map(async (a) => (await a.ready)!.dbPid!),
      ),
    );
  } finally {
    await hold.release();
  }
  const results = (await pending).map((r) => {
    if (r.status === 'rejected') throw r.reason;
    return r.value;
  });
  expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
  expect(results.map((r) => r.body.status).sort()).toEqual([
    'PROCESSED',
    'REJECTED',
  ]);
  expect(results.find((r) => r.status === 422)!.body.failureCode).toBe(
    'INSUFFICIENT_FUNDS',
  );
  expect(await f.orm.em.fork().count(LedgerEntity, { walletId: w.id })).toBe(2);
  for (const body of bodies)
    expect((await submit(apis[2]!, body)).body.idempotentReplay).toBe(true);
  await reconcile(f, w.id, '20.00');
  expect((await call(apis[2]!, `/wallets/${w.id}`)).body.balance).toEqual({
    amount: '20.00',
    currency: 'BRL',
  });
});

test('50 parallel SQS copies across three consumer processes bypass FIFO dedup and debit once', async () => {
  const w = await open(f),
    body = message(w);
  const consumers = await cluster(f, children, 'consumer', 3, 'before-process');
  await Promise.all(
    Array.from({ length: 50 }, () => send(f.client, f.urls.transactions, body)),
  );
  consumers.forEach((c) => c.start());
  await Promise.all(consumers.map((c) => c.wait('barrier')));
  consumers.forEach((c) => c.release());
  const committed = await until(
    () =>
      consumers.flatMap((c) =>
        c.events.filter((e) => e.event === 'message_committed'),
      ),
    (e) => e.length === 50,
    '50 committed SQS deliveries',
    20000,
  );
  expect(committed.filter((e) => e.idempotentReplay === false)).toHaveLength(1);
  expect(committed.filter((e) => e.idempotentReplay === true)).toHaveLength(49);
  expect(new Set(committed.map((e) => e.transactionId)).size).toBe(1);
  expect(await f.orm.em.fork().count(InboxEntity, {})).toBe(1);
  expect(await f.orm.em.fork().count(LedgerEntity, { walletId: w.id })).toBe(2);
  expect(await receive(f.client, f.urls.transactions)).toBeUndefined();
  expect(await receive(f.client, f.urls.deadLetters)).toBeUndefined();
  await reconcile(f, w.id, '75.00');
});
