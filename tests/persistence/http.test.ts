import { createServer } from 'node:net';
import { credit } from './helpers.js';
import { LockMode } from '@mikro-orm/core';
import { WagerTransactionKind } from '../../src/domain/wager-transaction.js';
import { WalletEntity } from '../../src/adapters/persistence/entities.js';
import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { request as nodeRequest } from 'node:http';
import { createApplication } from '../../src/composition/bootstrap.js';
import { DatabaseHttpServices } from '../../src/composition/http-services.js';
import { loadConfig } from '../../src/adapters/config/environment.js';
import type { WalletView } from '../../src/application/ports/financial-queries.js';
import {
  ReceiptEntity,
  TransactionEntity,
  LedgerEntity,
  OutboxEntity,
} from '../../src/adapters/persistence/entities.js';
import {
  disposableDatabase,
  unique,
  sql,
  expectSqlFailure,
  assertWalletsReconciled,
} from './helpers.js';
import { canonicalJson } from '../../src/application/idempotency.js';
import { financialRuntime } from '../../src/adapters/runtime/financial-runtime.js';

let fixture: Awaited<ReturnType<typeof disposableDatabase>>;
let app: Awaited<ReturnType<typeof createApplication>>;
let url: string;
beforeAll(async () => {
  fixture = await disposableDatabase();
  await fixture.orm.getMigrator().up();
  const config = { ...loadConfig(process.env).database, name: fixture.name };
  app = await createApplication(true, new DatabaseHttpServices(config));
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  await fixture?.close();
});
afterEach(async () => {
  await assertWalletsReconciled(fixture.orm.em.fork());
});
async function call(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  origin = url,
) {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    headers: response.headers,
  };
}
async function wallet(amount = '100.00', origin = url) {
  const result = await call(
    '/wallets',
    { playerId: unique(), initialBalance: { amount, currency: 'BRL' } },
    {},
    origin,
  );
  expect(result.status).toBe(201);
  return result.body as unknown as WalletView;
}
function wager(w: WalletView, overrides: Record<string, unknown> = {}) {
  return {
    providerId: 'provider',
    externalTransactionId: unique(),
    playerId: w.playerId,
    walletId: w.id,
    roundId: 'round',
    gameId: 'game',
    kind: 'BET',
    money: { amount: '25.00', currency: 'BRL' },
    ...overrides,
  };
}
async function submit(
  body: unknown,
  key: string = unique(),
  origin = url,
  headers: Record<string, string> = {},
) {
  return call(
    '/wagering/transactions',
    body,
    { 'Idempotency-Key': key, ...headers },
    origin,
  );
}
async function reconcile(w: WalletView, amount: string) {
  const current = await call(`/wallets/${w.id}`);
  expect(current.body.balance).toEqual({ amount, currency: 'BRL' });
  const [row] = (await sql(
    fixture.orm.em.fork(),
    `select w.balance = coalesce((select sum(case direction when 'CREDIT' then amount else -amount end)
    from wallet_ledger_entries where wallet_id = w.id),0) as consistent from wallets w where w.id = ?`,
    [w.id],
  )) as [{ consistent: boolean }];
  expect(row.consistent).toBe(true);
}

test('wallet creation and all query routes expose decimal strings without internal hash/key', async () => {
  const w = await wallet();
  expect(w.balance).toEqual({ amount: '100.00', currency: 'BRL' });
  expect(w.version).toBe(1);
  expect((await call(`/wallets/${w.id}`)).body).toEqual({ ...w });
  const input = wager(w);
  const result = await submit(input);
  expect(result.status).toBe(201);
  const byId = await call(
    `/wagering/transactions/${result.body.transactionId}`,
  );
  const byExternal = await call(
    `/providers/provider/wagering/transactions/${input.externalTransactionId}`,
  );
  expect(byId.status).toBe(200);
  expect(byExternal.body).toEqual(byId.body);
  expect(byId.body.money).toEqual(input.money);
  expect(byId.body.payloadHash).toBeUndefined();
  expect(byId.body.idempotencyKey).toBeUndefined();
  expect((await call(`/wallets/${w.id}/ledger`)).status).toBe(200);
  await reconcile(w, '75.00');
});

test('duplicate wallet is 409 and unknown wallets/transactions are 404', async () => {
  const w = await wallet();
  const duplicate = await call('/wallets', {
    playerId: w.playerId,
    initialBalance: w.balance,
  });
  expect(duplicate.status).toBe(409);
  expect(duplicate.body.code).toBe('WALLET_ALREADY_EXISTS');
  for (const path of [
    `/wallets/${unique()}`,
    `/wallets/${unique()}/ledger`,
    `/wagering/transactions/${unique()}`,
    `/providers/p/wagering/transactions/${unique()}`,
  ])
    expect((await call(path)).status).toBe(404);
  const missing = await submit(wager(w, { walletId: unique() }));
  expect(missing.status).toBe(404);
  await reconcile(w, '100.00');
});

test.each(['PROCESSED', 'REJECTED', 'PENDING_REFERENCE', 'LOSS'])(
  'replay of %s preserves original balance after unrelated movements',
  async (kind) => {
    const w = await wallet();
    const input = wager(
      w,
      kind === 'REJECTED'
        ? { money: { amount: '200.00', currency: 'BRL' } }
        : kind === 'PENDING_REFERENCE'
          ? { kind: 'REFUND', referenceExternalTransactionId: unique() }
          : kind === 'LOSS'
            ? { kind: 'LOSS', money: { amount: '0.00', currency: 'BRL' } }
            : {},
    );
    const key = unique();
    const first = await submit(input, key);
    expect(first.status).toBe(
      kind === 'REJECTED' ? 422 : kind === 'PENDING_REFERENCE' ? 202 : 201,
    );
    await submit(
      wager(w, { kind: 'WIN', money: { amount: '10.00', currency: 'BRL' } }),
    );
    const before = await fixture.orm.em.fork().count(OutboxEntity, {});
    const repeated = await submit(input, key, url, {
      'X-Correlation-Id': unique(),
    });
    expect(repeated.status).toBe(first.status === 201 ? 200 : first.status);
    expect(repeated.body).toEqual({ ...first.body, idempotentReplay: true });
    expect(await fixture.orm.em.fork().count(OutboxEntity, {})).toBe(before);
    expect(
      await fixture.orm.em.fork().count(ReceiptEntity, { idempotencyKey: key }),
    ).toBe(1);
    await reconcile(w, kind === 'PROCESSED' ? '85.00' : '110.00');
  },
);

test('canonical hash sorts nested keys and excludes key/correlation metadata', async () => {
  const w = await wallet();
  const input = wager(w);
  const key = unique();
  const first = await submit(input, key);
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  reordered.money = { currency: 'BRL', amount: '25.00' };
  const second = await submit(reordered, key, url, {
    'X-Correlation-Id': unique(),
  });
  expect(second.body).toEqual({ ...first.body, idempotentReplay: true });
  const stored = await fixture.orm.em
    .fork()
    .findOneOrFail(ReceiptEntity, { idempotencyKey: key });
  expect(stored.payloadHash).toBe(financialRuntime.hash(canonicalJson(input)));
  expect(stored.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  await reconcile(w, '75.00');
});

test('payload conflict, changed key and crossed identities preserve both original receipts', async () => {
  const w = await wallet();
  const firstInput = wager(w);
  const key = unique();
  const first = await submit(firstInput, key);
  const secondKey = unique();
  const secondInput = wager(w);
  await submit(secondInput, secondKey);
  for (const [body, changedKey] of [
    [{ ...firstInput, money: { amount: '1.00', currency: 'BRL' } }, key],
    [firstInput, unique()],
    [secondInput, key],
  ] as const) {
    const conflict = await submit(body, changedKey);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  }
  expect((await submit(firstInput, key)).body).toEqual({
    ...first.body,
    idempotentReplay: true,
  });
  await reconcile(w, '50.00');
});

test.each([
  'missing-header',
  'key-in-body',
  'opening',
  'numeric-money',
  'extra-field',
  'three-decimals',
  'too-large',
  'missing-reference',
  'null-body',
  'array-body',
])('invalid submission %s fails as 400 without side effects', async (fault) => {
  const w = await wallet();
  let input: unknown = wager(w);
  if (fault === 'key-in-body')
    input = { ...(input as object), idempotencyKey: 'body-key' };
  if (fault === 'opening') input = wager(w, { kind: 'OPENING' });
  if (fault === 'numeric-money')
    input = wager(w, { money: { amount: 25, currency: 'BRL' } });
  if (fault === 'extra-field')
    input = { ...(input as object), unexpected: true };
  if (fault === 'three-decimals')
    input = wager(w, { money: { amount: '25.001', currency: 'BRL' } });
  if (fault === 'too-large')
    input = wager(w, {
      money: { amount: `${'9'.repeat(37)}.00`, currency: 'BRL' },
    });
  if (fault === 'missing-reference') input = wager(w, { kind: 'REFUND' });
  if (fault === 'null-body') input = null;
  if (fault === 'array-body') input = [];
  const result =
    fault === 'missing-header'
      ? await call('/wagering/transactions', input)
      : await submit(input);
  expect(result.status).toBe(400);
  expect(
    await fixture.orm.em.fork().count(TransactionEntity, { walletId: w.id }),
  ).toBe(1);
  await reconcile(w, '100.00');
});

test('duplicate Idempotency-Key headers are rejected rather than combined', async () => {
  const w = await wallet();
  const payload = JSON.stringify(wager(w));
  const status = await new Promise<number>((resolve, reject) => {
    const req = nodeRequest(
      `${url}/wagering/transactions`,
      {
        method: 'POST',
        headers: [
          'Content-Type',
          'application/json',
          'Idempotency-Key',
          'first',
          'Idempotency-Key',
          'second',
          'Content-Length',
          String(Buffer.byteLength(payload)),
        ],
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode!));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
  expect(status).toBe(400);
  await reconcile(w, '100.00');
});

test('business rejection, missing reference and malformed JSON have distinct HTTP outcomes', async () => {
  const w = await wallet();
  const rejected = await submit(
    wager(w, { money: { amount: '200.00', currency: 'BRL' } }),
  );
  expect(rejected.status).toBe(422);
  expect(rejected.body.failureCode).toBe('INSUFFICIENT_FUNDS');
  const pending = await submit(
    wager(w, { kind: 'REFUND', referenceExternalTransactionId: unique() }),
  );
  expect(pending.status).toBe(202);
  expect(pending.body.status).toBe('PENDING_REFERENCE');
  const malformed = await fetch(`${url}/wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid',
  });
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toEqual({ code: 'INVALID_REQUEST' });
  await reconcile(w, '100.00');
});

test('ledger cursor freezes an upper bound and cannot be reused for another wallet', async () => {
  const w = await wallet();
  for (let index = 0; index < 3; index++)
    await submit(
      wager(w, { kind: 'WIN', money: { amount: '1.00', currency: 'BRL' } }),
    );
  const first = await call(`/wallets/${w.id}/ledger?limit=2`);
  expect(first.status).toBe(200);
  const firstItems = first.body.items as {
    id: string;
    walletVersion: number;
  }[];
  expect(firstItems.map((item) => item.walletVersion)).toEqual([1, 2]);
  const cursor = first.body.nextCursor as string;
  expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  await submit(
    wager(w, { kind: 'WIN', money: { amount: '1.00', currency: 'BRL' } }),
  );
  const second = await call(`/wallets/${w.id}/ledger?limit=2&cursor=${cursor}`);
  const items = second.body.items as { id: string; walletVersion: number }[];
  expect(items.map((item) => item.walletVersion)).toEqual([3, 4]);
  expect(new Set([...firstItems, ...items].map((item) => item.id)).size).toBe(
    4,
  );
  expect(second.body.nextCursor).toBeNull();
  expect(
    (await call(`/wallets/${w.id}/ledger`)).body.items as unknown[],
  ).toHaveLength(5);
  const other = await wallet('0.00');
  expect(
    (await call(`/wallets/${other.id}/ledger?cursor=${cursor}`)).status,
  ).toBe(400);
  expect((await call(`/wallets/${other.id}/ledger`)).body).toEqual({
    items: [],
    nextCursor: null,
  });
  for (const query of [
    'limit=0',
    'limit=101',
    'limit=-1',
    'limit=1.5',
    'limit=1&limit=2',
    'cursor=bad!',
    'cursor=',
    'offset=1',
  ])
    expect((await call(`/wallets/${w.id}/ledger?${query}`)).status).toBe(400);
  await reconcile(w, '104.00');
  await reconcile(other, '0.00');
});

test('receipt is immutable and rejects a fabricated snapshot via SQL', async () => {
  const w = await wallet();
  const input = wager(w);
  const key = unique();
  const result = await submit(input, key);
  for (const statement of [
    'update processing_receipts set balance = 1 where idempotency_key = ?',
    'delete from processing_receipts where idempotency_key = ?',
  ])
    await expectSqlFailure(
      () => sql(fixture.orm.em.fork(), statement, [key]),
      '23514',
    );
  await expectSqlFailure(
    () => sql(fixture.orm.em.fork(), 'truncate processing_receipts'),
    '23514',
  );
  const opening = await fixture.orm.em.fork().findOneOrFail(TransactionEntity, {
    walletId: w.id,
    kind: WagerTransactionKind.Opening,
  });
  await expectSqlFailure(
    () =>
      sql(
        fixture.orm.em.fork(),
        `insert into processing_receipts values (?,?,?,?,?,'PROCESSED',1,'BRL',1,null)`,
        [
          opening.id,
          opening.idempotencyKey,
          opening.providerId,
          opening.externalTransactionId,
          opening.payloadHash,
        ],
      ),
    '23514',
  );
  expect((await submit(input, key)).body).toEqual({
    ...result.body,
    idempotentReplay: true,
  });
  await reconcile(w, '75.00');
});

async function deadline<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Process readiness timed out')),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function childServer() {
  const script = `import { createApplication } from './dist/composition/bootstrap.js';
    import { DatabaseHttpServices } from './dist/composition/http-services.js';
    import { loadConfig } from './dist/adapters/config/environment.js';
    const app = await createApplication(true, new DatabaseHttpServices(loadConfig(process.env).database));
    await app.listen(0, '127.0.0.1'); console.log(JSON.stringify({url:await app.getUrl()}));`;
  const child = Bun.spawn([process.execPath, '--eval', script], {
    env: { ...process.env, DB_NAME: fixture.name },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  try {
    const reader = child.stdout.getReader();
    let output = '';
    await deadline(
      (async () => {
        while (!output.includes('\n')) {
          const next = await reader.read();
          if (next.done) throw new Error('Child exited before ready');
          output += new TextDecoder().decode(next.value);
        }
      })(),
    );
    reader.releaseLock();
    const origin = (JSON.parse(output.split('\n')[0]!) as { url: string }).url;
    return {
      origin,
      stop: async () => {
        child.kill('SIGTERM');
        await deadline(child.exited);
      },
    };
  } catch (error) {
    child.kill('SIGKILL');
    await child.exited;
    throw error;
  }
}

test('fresh process after HTTP server termination replays the committed original response', async () => {
  const firstServer = await childServer();
  let w!: WalletView;
  let input!: ReturnType<typeof wager>;
  const key = unique();
  let original!: Record<string, unknown>;
  try {
    w = await wallet('100.00', firstServer.origin);
    input = wager(w);
    original = (await submit(input, key, firstServer.origin)).body;
  } finally {
    await firstServer.stop();
  }
  await submit(
    wager(w, { kind: 'WIN', money: { amount: '10.00', currency: 'BRL' } }),
  );
  const restarted = await childServer();
  try {
    const result = await submit(input, key, restarted.origin);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ...original, idempotentReplay: true });
  } finally {
    await restarted.stop();
  }
  await reconcile(w, '85.00');
});

async function concurrent(
  walls: WalletView[],
  requests: (() => ReturnType<typeof submit>)[],
) {
  const control = fixture.orm.em.fork();
  await control.begin();
  let running: Promise<Awaited<ReturnType<typeof submit>>[]> | undefined;
  try {
    for (const w of walls)
      await control.findOneOrFail(
        WalletEntity,
        { id: w.id },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
    const [{ pid }] = (await sql(
      control,
      'select pg_backend_pid() as pid',
    )) as [{ pid: number }];
    running = Promise.all(requests.map((request) => request()));
    const expires = Date.now() + 5000;
    let observed = false;
    while (Date.now() < expires) {
      const rows = (await sql(
        fixture.orm.em.fork(),
        `with recursive blocked(pid) as (
        select ?::integer union select a.pid from pg_stat_activity a join blocked b on b.pid = any(pg_blocking_pids(a.pid))
      ) select pid from blocked where pid <> ?`,
        [pid, pid],
      )) as { pid: number }[];
      if (new Set(rows.map((row) => row.pid)).size === requests.length) {
        observed = true;
        break;
      }
      await Bun.sleep(10);
    }
    expect(observed).toBe(true);
  } finally {
    await control.rollback();
  }
  return running!;
}

test('identical simultaneous HTTP submissions produce one debit and one durable replay', async () => {
  const w = await wallet();
  const input = wager(w);
  const key = unique();
  const results = await concurrent(
    [w],
    [() => submit(input, key), () => submit(input, key)],
  );
  expect(results.map((result) => result.status).sort()).toEqual([200, 201]);
  const original = results.find((result) => result.status === 201)!;
  expect(results.find((result) => result.status === 200)!.body).toEqual({
    ...original.body,
    idempotentReplay: true,
  });
  expect(
    await fixture.orm.em.fork().count(ReceiptEntity, { idempotencyKey: key }),
  ).toBe(1);
  expect(
    await fixture.orm.em.fork().count(LedgerEntity, { walletId: w.id }),
  ).toBe(2);
  expect(
    await fixture.orm.em.fork().count(OutboxEntity, {
      aggregateId: original.body.transactionId as string,
    }),
  ).toBe(1);
  await reconcile(w, '75.00');
});

test('divergent simultaneous payloads on the same wallet commit one outcome and return conflict', async () => {
  const w = await wallet();
  const first = wager(w);
  const key = unique();
  const second = { ...first, money: { amount: '30.00', currency: 'BRL' } };
  const results = await concurrent(
    [w],
    [() => submit(first, key), () => submit(second, key)],
  );
  expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  expect(results.find((result) => result.status === 409)!.body.code).toBe(
    'IDEMPOTENCY_CONFLICT',
  );
  const balance = results.find((result) => result.status === 201)!.body
    .balance as { amount: string };
  expect(['75.00', '70.00']).toContain(balance.amount);
  await reconcile(w, balance.amount);
});

test('same key racing across different wallets rolls back the loser before inspecting the committed receipt', async () => {
  const a = await wallet();
  const b = await wallet();
  const key = unique();
  const results = await concurrent(
    [a, b],
    [() => submit(wager(a), key), () => submit(wager(b), key)],
  );
  expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  const winner = results.find((result) => result.status === 201)!;
  const transaction = await call(
    `/wagering/transactions/${winner.body.transactionId}`,
  );
  await reconcile(a, transaction.body.walletId === a.id ? '75.00' : '100.00');
  await reconcile(b, transaction.body.walletId === b.id ? '75.00' : '100.00');
  expect(
    await fixture.orm.em
      .fork()
      .count(TransactionEntity, { idempotencyKey: key }),
  ).toBe(1);
  expect(
    await fixture.orm.em.fork().count(ReceiptEntity, { idempotencyKey: key }),
  ).toBe(1);
});

test('legacy transaction without a receipt conflicts without fabricating an original balance', async () => {
  const legacy = await credit(fixture.orm);
  const resource = await call(`/wallets/${legacy.id}`);
  const w = resource.body as unknown as WalletView;
  const result = await submit(
    wager(w, {
      kind: 'WIN',
      externalTransactionId: legacy.tx,
      money: { amount: '100.00', currency: 'BRL' },
    }),
    legacy.tx,
  );
  expect(result.status).toBe(409);
  expect(result.body.code).toBe('TRANSACTION_IDENTITY_CONFLICT');
  expect(
    await fixture.orm.em
      .fork()
      .count(ReceiptEntity, { transactionId: legacy.tx }),
  ).toBe(0);
  await reconcile(w, '100.00');
});

test('real refused PostgreSQL connection returns 503 while liveness remains available', async () => {
  const reservation = createServer();
  await new Promise<void>((resolve) =>
    reservation.listen(0, '127.0.0.1', resolve),
  );
  const address = reservation.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected TCP address');
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  const services = new DatabaseHttpServices({
    ...loadConfig(process.env).database,
    host: '127.0.0.1',
    port: address.port,
  });
  const unavailable = await createApplication(true, services);
  try {
    await unavailable.listen(0, '127.0.0.1');
    const origin = await unavailable.getUrl();
    const result = await call('/wallets/example', undefined, {}, origin);
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ code: 'INFRASTRUCTURE_TRANSIENT' });
    expect(result.headers.get('retry-after')).toBe('1');
    expect((await call('/health/live', undefined, {}, origin)).status).toBe(
      200,
    );
  } finally {
    await unavailable.close();
  }
});
