import type { FailureCode } from '../../src/domain/errors.js';
import { beforeEach, afterEach, expect, test } from 'bun:test';
import { FinancialProcessing } from '../../src/application/financial-processing.js';
import type { ProcessWagerCommand } from '../../src/application/financial-processing.js';
import {
  MikroFinancialSession,
  MikroFinancialUnitOfWork,
} from '../../src/adapters/persistence/financial-unit-of-work.js';
import { financialRuntime } from '../../src/adapters/runtime/financial-runtime.js';
import { loadConfig } from '../../src/adapters/config/environment.js';
import { MikroFinancialQueries } from '../../src/adapters/persistence/financial-queries.js';
import {
  ReferenceJobEntity,
  TransactionEntity,
  WalletEntity,
  LedgerEntity,
  OutboxEntity,
  ReceiptEntity,
} from '../../src/adapters/persistence/entities.js';
import {
  WagerTransactionKind as Kind,
  WagerTransactionStatus as Status,
} from '../../src/domain/wager-transaction.js';
import {
  disposableDatabase,
  unique,
  sql,
  expectSqlFailure,
  transaction,
  wallet as rawWallet,
} from './helpers.js';

let f: Awaited<ReturnType<typeof disposableDatabase>>;
let now: string;
let service: FinancialProcessing;
const ctx = {
  correlationId: 'reference-correlation',
  causationId: 'reference-causation',
};
const runtime = { ...financialRuntime, now: () => now };
beforeEach(async () => {
  f = await disposableDatabase();
  await f.orm.getMigrator().up();
  now = '2026-10-14T12:00:00.000Z';
  service = new FinancialProcessing(
    new MikroFinancialUnitOfWork(f.orm),
    runtime,
  );
});
afterEach(async () => {
  try {
    const mismatches = await sql(
      f.orm.em.fork(),
      `select w.id from wallets w where w.balance <> coalesce(
      (select sum(case direction when 'CREDIT' then amount else -amount end) from wallet_ledger_entries where wallet_id=w.id),0)`,
    );
    expect(mismatches).toEqual([]);
  } finally {
    await f?.close();
  }
});
async function open() {
  return service.createWallet(
    {
      playerId: unique(),
      initialBalance: { amount: '100.00', currency: 'BRL' },
    },
    ctx,
  );
}
type Opened = Awaited<ReturnType<typeof open>>;
function command(
  w: Opened,
  extra: Partial<ProcessWagerCommand> = {},
): ProcessWagerCommand {
  return {
    walletId: w.id,
    playerId: w.playerId,
    providerId: 'provider',
    externalTransactionId: unique(),
    idempotencyKey: unique(),
    roundId: 'round',
    gameId: 'game',
    kind: Kind.Bet,
    money: { amount: '25.00', currency: 'BRL' },
    ...extra,
  };
}
async function pending(
  w: Opened,
  kind = Kind.Refund as ProcessWagerCommand['kind'],
  external = unique(),
) {
  const input = command(w, { kind, referenceExternalTransactionId: external });
  const result = await service.process(input, ctx);
  return { input, result, external };
}
async function job(id: string) {
  return f.orm.em
    .fork()
    .findOneOrFail(ReferenceJobEntity, { transactionId: id });
}
async function state(id: string) {
  return f.orm.em.fork().findOneOrFail(TransactionEntity, { id });
}
async function balance(w: Opened, expected: string) {
  const em = f.orm.em.fork();
  expect((await em.findOneOrFail(WalletEntity, { id: w.id })).balance).toBe(
    expected,
  );
  const [row] = (await sql(
    em,
    `select w.balance = coalesce((select sum(case direction when 'CREDIT' then amount else -amount end) from wallet_ledger_entries where wallet_id=w.id),0) as consistent from wallets w where w.id=?`,
    [w.id],
  )) as { consistent: boolean }[];
  expect(row!.consistent).toBe(true);
}
async function txEvents(id: string) {
  return f.orm.em
    .fork()
    .find(
      OutboxEntity,
      { aggregateId: id },
      { orderBy: { occurredAt: 'asc' } },
    );
}
function due() {
  now = '2026-10-14T12:00:01.000Z';
}

test.each([Kind.Refund, Kind.Rollback, Kind.Win])(
  'late reference resolves %s exactly once and preserves original receipt',
  async (kind) => {
    const w = await open();
    const p = await pending(w, kind);
    expect((await job(p.result.transactionId)).attempts).toBe(0);
    expect(await service.retryReference()).toBeUndefined();
    await service.process(
      command(w, { externalTransactionId: p.external }),
      ctx,
    );
    due();
    expect((await service.retryReference())!.status).toBe(Status.Processed);
    expect(await service.retryReference()).toBeUndefined();
    await balance(w, '100.00');
    expect(
      await f.orm.em
        .fork()
        .count(LedgerEntity, { transactionId: p.result.transactionId }),
    ).toBe(1);
    expect((await job(p.result.transactionId)).completedAt).not.toBeNull();
    expect(await service.process(p.input, ctx)).toEqual({
      ...p.result,
      idempotentReplay: true,
    });
    expect(
      (
        await new MikroFinancialQueries(f.orm).transaction(
          p.result.transactionId,
        )
      ).status,
    ).toBe(Status.Processed);
    const events = await txEvents(p.result.transactionId);
    expect(events.map((e) => e.eventType)).toEqual([
      'WagerTransactionPendingReference',
      'WagerTransactionProcessed',
    ]);
    expect(events[1]!.payload).toMatchObject({
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
    });
  },
);

test('missing reference backs off durably without repeating pending events or touching receipt', async () => {
  const w = await open();
  const p = await pending(w);
  for (const seconds of [1, 3, 7]) {
    now = `2026-10-14T12:00:0${seconds}.000Z`;
    expect((await service.retryReference())!.status).toBe(
      Status.PendingReference,
    );
  }
  const j = await job(p.result.transactionId);
  expect(j.attempts).toBe(3);
  expect(j.nextAttemptAt.toISOString()).toBe('2026-10-14T12:00:15.000Z');
  expect(await service.retryReference()).toBeUndefined();
  expect(await txEvents(p.result.transactionId)).toHaveLength(1);
  expect(
    await f.orm.em
      .fork()
      .count(ReceiptEntity, { transactionId: p.result.transactionId }),
  ).toBe(1);
  await balance(w, '100.00');
});

test.each([false, true])(
  'expiry is terminal and auditable (late reference: %s)',
  async (late) => {
    const w = await open();
    const p = await pending(w);
    if (late)
      await service.process(
        command(w, { externalTransactionId: p.external }),
        ctx,
      );
    now = '2026-10-15T12:00:00.000Z';
    expect((await service.retryReference())!.status).toBe(Status.Rejected);
    expect((await state(p.result.transactionId)).failureCode).toBe(
      'REFERENCE_NOT_FOUND',
    );
    expect(
      (await txEvents(p.result.transactionId)).map((e) => e.eventType),
    ).toEqual(['WagerTransactionPendingReference', 'WagerTransactionRejected']);
    expect(await service.retryReference()).toBeUndefined();
    expect(await service.process(p.input, ctx)).toEqual({
      ...p.result,
      idempotentReplay: true,
    });
    await balance(w, late ? '75.00' : '100.00');
  },
);

test.each([
  'provider',
  'wallet',
  'round',
  'kind',
  'amount',
  'rejected',
  'currency',
  'player',
])('late reference enforces %s scope and validity', async (fault) => {
  const w = await open();
  const p = await pending(w);
  let refWallet = w;
  if (['wallet', 'player', 'currency'].includes(fault)) {
    refWallet = await service.createWallet(
      {
        playerId: fault === 'currency' ? w.playerId : unique(),
        initialBalance: {
          amount: '100.00',
          currency: fault === 'currency' ? 'USD' : 'BRL',
        },
      },
      ctx,
    );
  }
  await service.process(
    command(refWallet, {
      externalTransactionId: p.external,
      providerId: fault === 'provider' ? 'other-provider' : 'provider',
      roundId: fault === 'round' ? 'other-round' : 'round',
      kind: fault === 'kind' ? Kind.Win : Kind.Bet,
      money: {
        amount:
          fault === 'amount'
            ? '10.00'
            : fault === 'rejected'
              ? '200.00'
              : '25.00',
        currency: refWallet.balance.currency,
      },
    }),
    ctx,
  );
  due();
  await service.retryReference();
  const t = await state(p.result.transactionId);
  expect(t.status).toBe(
    fault === 'provider' ? Status.PendingReference : Status.Rejected,
  );
  if (fault !== 'provider')
    expect(t.failureCode).toBe(
      (
        {
          wallet: 'REFERENCE_SCOPE_MISMATCH',
          player: 'REFERENCE_SCOPE_MISMATCH',
          currency: 'REFERENCE_SCOPE_MISMATCH',
          round: 'REFERENCE_SCOPE_MISMATCH',
          kind: 'REFERENCE_KIND_MISMATCH',
          amount: 'REFERENCE_AMOUNT_MISMATCH',
          rejected: 'REFERENCE_NOT_PROCESSED',
        } as Record<string, FailureCode>
      )[fault]!,
    );
  expect(
    await f.orm.em.fork().count(LedgerEntity, { transactionId: t.id }),
  ).toBe(0);
  await balance(
    w,
    ['wallet', 'player', 'currency', 'rejected'].includes(fault)
      ? '100.00'
      : fault === 'amount'
        ? '90.00'
        : fault === 'kind'
          ? '125.00'
          : '75.00',
  );
});

test('rollback of a late credit refuses negative balance', async () => {
  const w = await open();
  const p = await pending(w, Kind.Rollback);
  await service.process(
    command(w, { kind: Kind.Win, externalTransactionId: p.external }),
    ctx,
  );
  await service.process(
    command(w, { money: { amount: '125.00', currency: 'BRL' } }),
    ctx,
  );
  due();
  await service.retryReference();
  expect((await state(p.result.transactionId)).failureCode).toBe(
    'REVERSAL_INSUFFICIENT_FUNDS',
  );
  await balance(w, '0.00');
});

test('two pending refunds cannot reverse the same reference twice', async () => {
  const w = await open();
  const a = await pending(w);
  const b = await pending(w, Kind.Refund, a.external);
  await service.process(command(w, { externalTransactionId: a.external }), ctx);
  due();
  await Promise.all([service.retryReference(), service.retryReference()]);
  await service.retryReference();
  const states = await Promise.all([
    state(a.result.transactionId),
    state(b.result.transactionId),
  ]);
  expect(states.map((t) => t.status).sort()).toEqual([
    Status.Processed,
    Status.Rejected,
  ]);
  expect(states.find((t) => t.status === Status.Rejected)!.failureCode).toBe(
    'REFERENCE_ALREADY_REVERSED',
  );
  await balance(w, '100.00');
});

test('claim skips an occupied wallet and allows a second worker to progress on another', async () => {
  const w1 = await open(),
    w2 = await open();
  const a = await pending(w1),
    b = await pending(w2);
  await service.process(
    command(w1, { externalTransactionId: a.external }),
    ctx,
  );
  await service.process(
    command(w2, { externalTransactionId: b.external }),
    ctx,
  );
  due();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  let firstId = '';
  const first = new FinancialProcessing(
    {
      run: (work) =>
        f.orm.em.fork().transactional(async (em) => {
          const session = new MikroFinancialSession(em);
          const claim = session.claimReference.bind(session);
          session.claimReference = async (at) => {
            const picked = await claim(at);
            firstId = picked!.job.transactionId;
            entered();
            await gate;
            return picked;
          };
          return work(session);
        }),
    },
    runtime,
  );
  const running = first.retryReference();
  try {
    await started;
    const other = await service.retryReference();
    expect(other).toBeDefined();
    expect(other!.transactionId).not.toBe(firstId);
  } finally {
    release();
    await running;
  }
  await balance(w1, '100.00');
  await balance(w2, '100.00');
});

test('a second worker cannot claim the same wallet while the first attempt is in flight', async () => {
  const w = await open();
  const p = await pending(w);
  await service.process(command(w, { externalTransactionId: p.external }), ctx);
  due();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  const first = new FinancialProcessing(
    {
      run: (work) =>
        f.orm.em.fork().transactional(async (em) => {
          const session = new MikroFinancialSession(em);
          const claim = session.claimReference.bind(session);
          session.claimReference = async (at) => {
            const picked = await claim(at);
            entered();
            await gate;
            return picked;
          };
          return work(session);
        }),
    },
    runtime,
  );
  const running = first.retryReference();
  try {
    await started;
    expect(await service.retryReference()).toBeUndefined();
  } finally {
    release();
    await running;
  }
  expect((await job(p.result.transactionId)).attempts).toBe(1);
  await balance(w, '100.00');
});

test('failure after flush rolls back attempt, balance, ledger, terminal event and transaction', async () => {
  const w = await open();
  const p = await pending(w);
  await service.process(command(w, { externalTransactionId: p.external }), ctx);
  due();
  const broken = new FinancialProcessing(
    {
      run: (work) =>
        f.orm.em.fork().transactional(async (em) => {
          await work(new MikroFinancialSession(em));
          await em.flush();
          throw new Error('injected failure');
        }),
    },
    runtime,
  );
  await expect(broken.retryReference()).rejects.toThrow('injected failure');
  expect((await job(p.result.transactionId)).attempts).toBe(0);
  expect((await state(p.result.transactionId)).status).toBe(
    Status.PendingReference,
  );
  expect(await txEvents(p.result.transactionId)).toHaveLength(1);
  await balance(w, '75.00');
  await service.retryReference();
  await balance(w, '100.00');
});

test('job constraints protect context, progress and completion', async () => {
  const w = await open();
  const p = await pending(w);
  for (const mutation of [
    "correlation_id='changed'",
    'attempts=2',
    'completed_at=now(), attempts=1',
  ]) {
    await expectSqlFailure(
      () =>
        sql(
          f.orm.em.fork(),
          `update reference_jobs set ${mutation} where transaction_id=?`,
          [p.result.transactionId],
        ),
      '23514',
    );
  }
  await expectSqlFailure(
    () =>
      sql(
        f.orm.em.fork(),
        'delete from reference_jobs where transaction_id=?',
        [p.result.transactionId],
      ),
    '23514',
  );
  await balance(w, '100.00');
});

test('migration backfills legacy pending work, preserves context and reverts without deleting finance', async () => {
  const w = await open();
  const original = await pending(w);
  await f.orm.getMigrator().down({ migrations: ['Migration202610140004'] });
  let id = '';
  await f.orm.em.fork().transactional(async (em) => {
    const wid = await rawWallet(em);
    id = await transaction(em, {
      walletId: wid,
      kind: 'REFUND',
      status: Status.PendingReference,
      referenceExternal: unique(),
    });
  });
  await f.orm.getMigrator().up();
  expect((await job(id)).correlationId).toBe(id);
  expect((await job(original.result.transactionId)).correlationId).toBe(
    ctx.correlationId,
  );
  expect((await job(original.result.transactionId)).causationId).toBe(
    ctx.causationId,
  );
  now = '2026-10-15T12:00:00.000Z';
  await service.retryReference();
  await service.retryReference();
  expect((await state(id)).failureCode).toBe('REFERENCE_NOT_FOUND');
  await f.orm.getMigrator().down({ migrations: ['Migration202610140004'] });
  expect((await state(id)).status).toBe(Status.Rejected);
  await f.orm.getMigrator().up();
});

test('scheduled process survives SIGTERM and a fresh process resumes its persistent schedule', async () => {
  now = new Date(Date.now() - 60_000).toISOString();
  const w = await open();
  const p = await pending(w);
  const config = loadConfig(process.env).database;
  const env = {
    ...process.env,
    DB_NAME: f.name,
    DB_HOST: config.host,
    DB_PORT: String(config.port),
    DB_USER: config.user,
    DB_PASSWORD: config.password,
  };
  const child = Bun.spawn(
    [process.execPath, 'dist/composition/reference-main.js'],
    { env, stdout: 'pipe', stderr: 'pipe' },
  );
  const reader = child.stdout.getReader();
  try {
    const output = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('worker did not run')), 8000).unref(),
      ),
    ]);
    expect(new TextDecoder().decode(output.value)).toContain(
      'reference_attempt',
    );
  } finally {
    reader.releaseLock();
    child.kill('SIGTERM');
    await child.exited;
  }
  expect((await job(p.result.transactionId)).attempts).toBe(1);
  now = new Date().toISOString();
  await service.process(command(w, { externalTransactionId: p.external }), ctx);
  const wait = Math.max(
    0,
    (await job(p.result.transactionId)).nextAttemptAt.getTime() -
      Date.now() +
      20,
  );
  await Bun.sleep(wait);
  const next = Bun.spawn(
    [process.execPath, 'dist/composition/reference-main.js', '--once'],
    { env, stdout: 'pipe', stderr: 'pipe' },
  );
  expect(await next.exited).toBe(0);
  expect(await new Response(next.stdout).text()).toContain(Status.Processed);
  expect((await job(p.result.transactionId)).attempts).toBe(2);
  await balance(w, '100.00');
});

test('SIGKILL after flush releases claims and rolls back all effects before another worker resumes', async () => {
  now = new Date(Date.now() - 60_000).toISOString();
  const w = await open();
  const p = await pending(w);
  await service.process(command(w, { externalTransactionId: p.external }), ctx);
  const config = loadConfig(process.env).database;
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `
    import { loadConfig } from './dist/adapters/config/environment.js';
    import { connectDatabase } from './dist/adapters/persistence/database.js';
    import { MikroFinancialSession } from './dist/adapters/persistence/financial-unit-of-work.js';
    import { FinancialProcessing } from './dist/application/financial-processing.js';
    import { financialRuntime } from './dist/adapters/runtime/financial-runtime.js';
    const orm=await connectDatabase(loadConfig(process.env).database);
    const service=new FinancialProcessing({run:work=>orm.em.fork().transactional(async em=>{
      await work(new MikroFinancialSession(em)); await em.flush(); console.log('FLUSHED');
      await new Promise(()=>{setInterval(()=>{},1000);});
    })},financialRuntime);
    await service.retryReference();
  `,
    ],
    {
      env: {
        ...process.env,
        DB_NAME: f.name,
        DB_HOST: config.host,
        DB_PORT: String(config.port),
        DB_USER: config.user,
        DB_PASSWORD: config.password,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const reader = child.stdout.getReader();
  try {
    const output = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('worker did not flush')),
          8000,
        ).unref(),
      ),
    ]);
    expect(new TextDecoder().decode(output.value)).toContain('FLUSHED');
  } finally {
    reader.releaseLock();
    child.kill('SIGKILL');
    await child.exited;
  }
  expect((await job(p.result.transactionId)).attempts).toBe(0);
  expect((await state(p.result.transactionId)).status).toBe(
    Status.PendingReference,
  );
  expect(await txEvents(p.result.transactionId)).toHaveLength(1);
  await balance(w, '75.00');
  now = new Date().toISOString();
  await service.retryReference();
  await balance(w, '100.00');
});

test('initial pending transaction, schedule, receipt and event roll back together', async () => {
  const w = await open();
  const input = command(w, {
    kind: Kind.Refund,
    referenceExternalTransactionId: unique(),
  });
  const broken = new FinancialProcessing(
    {
      run: (work) =>
        f.orm.em.fork().transactional(async (em) => {
          await work(new MikroFinancialSession(em));
          await em.flush();
          throw new Error('pending commit failed');
        }),
    },
    runtime,
  );
  await expect(broken.process(input, ctx)).rejects.toThrow(
    'pending commit failed',
  );
  const em = f.orm.em.fork();
  expect(
    await em.count(TransactionEntity, {
      externalTransactionId: input.externalTransactionId,
    }),
  ).toBe(0);
  expect(await em.count(ReferenceJobEntity, {})).toBe(0);
  expect(await em.count(ReceiptEntity, {})).toBe(0);
  expect(
    await em.count(OutboxEntity, {
      eventType: 'WagerTransactionPendingReference',
    }),
  ).toBe(0);
  const committed = await service.process(input, ctx);
  expect((await job(committed.transactionId)).attempts).toBe(0);
  await balance(w, '100.00');
});
