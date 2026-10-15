import { ReceiptEntity } from '../../src/adapters/persistence/entities.js';
import { IdempotencyConflictError } from '../../src/application/idempotency.js';
import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { LockMode, IsolationLevel } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { FailureCode } from '../../src/domain/errors.js';
import { FinancialProcessing } from '../../src/application/financial-processing.js';
import type { ProcessWagerCommand } from '../../src/application/financial-processing.js';
import type {
  FinancialUnitOfWork,
  FinancialSession,
} from '../../src/application/ports/financial-store.js';
import {
  FinancialConflictError,
  WalletNotFoundError,
} from '../../src/application/ports/financial-store.js';
import { MikroFinancialSession } from '../../src/adapters/persistence/financial-unit-of-work.js';
import { createFinancialProcessing } from '../../src/composition/financial-processing.js';
import { connectDatabase } from '../../src/adapters/persistence/database.js';
import { loadConfig } from '../../src/adapters/config/environment.js';
import { financialRuntime } from '../../src/adapters/runtime/financial-runtime.js';
import {
  WalletEntity,
  TransactionEntity,
  LedgerEntity,
  OutboxEntity,
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
  assertWalletsReconciled,
} from './helpers.js';

let fixture: Awaited<ReturnType<typeof disposableDatabase>>;
let monitor: Awaited<ReturnType<typeof connectDatabase>>;
let service: FinancialProcessing;
const context = () => ({ correlationId: unique(), causationId: unique() });
beforeAll(async () => {
  fixture = await disposableDatabase();
  await fixture.orm.getMigrator().up();
  monitor = await connectDatabase({
    ...loadConfig(process.env).database,
    name: fixture.name,
  });
  service = createFinancialProcessing(fixture.orm);
});
afterAll(async () => {
  await monitor?.close(true);
  await fixture?.close();
});
afterEach(async () => {
  await assertWalletsReconciled(fixture.orm.em.fork());
});
async function open(amount = '100.00', currency = 'BRL') {
  return service.createWallet(
    { playerId: unique(), initialBalance: { amount, currency } },
    context(),
  );
}
type Opened = Awaited<ReturnType<typeof open>>;
function command(
  wallet: Opened,
  overrides: Partial<ProcessWagerCommand> = {},
): ProcessWagerCommand {
  return {
    walletId: wallet.id,
    playerId: wallet.playerId,
    providerId: 'provider',
    externalTransactionId: unique(),
    idempotencyKey: unique(),
    roundId: 'round',
    gameId: 'game',
    kind: Kind.Bet,
    money: { amount: '25.00', currency: wallet.balance.currency },
    ...overrides,
  };
}
async function assertBalance(
  wallet: Opened,
  amount: string,
  version: number,
  entries: number,
) {
  const em = fixture.orm.em.fork();
  const stored = await em.findOneOrFail(WalletEntity, { id: wallet.id });
  expect(stored.balance).toBe(amount);
  expect(stored.version).toBe(version);
  expect(await em.count(LedgerEntity, { walletId: wallet.id })).toBe(entries);
  const [reconciled] = (await sql(
    em,
    `select w.balance = coalesce((select sum(case direction when 'CREDIT' then amount else -amount end)
    from wallet_ledger_entries where wallet_id = w.id),0) as consistent from wallets w where w.id = ?`,
    [wallet.id],
  )) as { consistent: boolean }[];
  expect(reconciled!.consistent).toBe(true);
}
async function events(transactionId: string) {
  return fixture.orm.em.fork().find(OutboxEntity, {
    $or: [
      { aggregateId: transactionId },
      { payload: { data: { transactionId } } },
    ],
  });
}
async function assertOutcome(
  transactionId: string,
  status: Status,
  hasLedger: boolean,
  failureCode?: FailureCode,
) {
  const em = fixture.orm.em.fork();
  const transaction = await em.findOneOrFail(TransactionEntity, {
    id: transactionId,
  });
  expect(transaction.status).toBe(status);
  expect(transaction.failureCode).toBe(failureCode ?? null);
  expect(await em.count(LedgerEntity, { transactionId })).toBe(
    hasLedger ? 1 : 0,
  );
  const outbox = await events(transactionId);
  expect(outbox.map((event) => event.eventType).sort()).toEqual(
    [
      status === Status.Processed
        ? 'WagerTransactionProcessed'
        : status === Status.Rejected
          ? 'WagerTransactionRejected'
          : 'WagerTransactionPendingReference',
      ...(hasLedger ? ['WalletBalanceChanged'] : []),
    ].sort(),
  );
  expect(outbox.every((event) => event.publishedAt === null)).toBe(true);
}

test.each(['0.00', '100.00'])(
  'wallet opening %s persists the exact atomic set',
  async (amount) => {
    const ctx = context();
    const wallet = await service.createWallet(
      { playerId: unique(), initialBalance: { amount, currency: 'BRL' } },
      ctx,
    );
    const em = fixture.orm.em.fork();
    const transactions = await em.find(TransactionEntity, {
      walletId: wallet.id,
    });
    expect(transactions).toHaveLength(amount === '0.00' ? 0 : 1);
    if (transactions[0]) {
      expect(transactions[0].kind).toBe(Kind.Opening);
      await assertOutcome(transactions[0].id, Status.Processed, true);
      for (const event of await events(transactions[0].id)) {
        expect(event.payload).toMatchObject({
          correlationId: ctx.correlationId,
          causationId: ctx.causationId,
          version: 1,
        });
      }
    } else
      expect(await em.count(OutboxEntity, { aggregateId: wallet.id })).toBe(0);
    await assertBalance(wallet, amount, 1, amount === '0.00' ? 0 : 1);
  },
);

test('duplicate wallet conflicts without another opening or event', async () => {
  const wallet = await open();
  await expect(
    service.createWallet(
      { playerId: wallet.playerId, initialBalance: wallet.balance },
      context(),
    ),
  ).rejects.toBeInstanceOf(FinancialConflictError);
  expect(
    await fixture.orm.em
      .fork()
      .count(WalletEntity, { playerId: wallet.playerId }),
  ).toBe(1);
  await assertBalance(wallet, '100.00', 1, 1);
});

test.each(['BRL', 'USD', 'EUR'])(
  'BET, standalone WIN and LOSS preserve exact balance and events in %s',
  async (currency) => {
    const wallet = await open('100.00', currency);
    const bet = await service.process(command(wallet), context());
    const win = await service.process(
      command(wallet, { kind: Kind.Win, money: { amount: '10.01', currency } }),
      context(),
    );
    const loss = await service.process(
      command(wallet, { kind: Kind.Loss, money: { amount: '0.00', currency } }),
      context(),
    );
    expect(bet.balance.amount).toBe('75.00');
    expect(win.balance.amount).toBe('85.01');
    expect(loss.balance.amount).toBe('85.01');
    await assertOutcome(bet.transactionId, Status.Processed, true);
    await assertOutcome(win.transactionId, Status.Processed, true);
    await assertOutcome(loss.transactionId, Status.Processed, false);
    await assertBalance(wallet, '85.01', 3, 3);
  },
);

test('insufficient BET is an auditable rejection with no movement', async () => {
  const wallet = await open('10.00');
  const result = await service.process(command(wallet), context());
  await assertOutcome(
    result.transactionId,
    Status.Rejected,
    false,
    'INSUFFICIENT_FUNDS',
  );
  await assertBalance(wallet, '10.00', 1, 1);
});

test.each(['player', 'currency'])(
  'incompatible %s is rejected and original submitted fields are retained',
  async (field) => {
    const wallet = await open();
    const input = command(
      wallet,
      field === 'player'
        ? { playerId: unique() }
        : { money: { amount: '25.00', currency: 'USD' } },
    );
    const result = await service.process(input, context());
    await assertOutcome(
      result.transactionId,
      Status.Rejected,
      false,
      field === 'player' ? 'WALLET_MISMATCH' : 'CURRENCY_MISMATCH',
    );
    const row = await fixture.orm.em
      .fork()
      .findOneOrFail(TransactionEntity, { id: result.transactionId });
    expect(row.playerId).toBe(input.playerId);
    expect(row.currency).toBe(input.money.currency);
    await assertBalance(wallet, '100.00', 1, 1);
  },
);

test('resolved WIN and full REFUND use provider/external identity and duplicate reversal is rejected', async () => {
  const wallet = await open();
  const bet = command(wallet);
  await service.process(bet, context());
  const win = await service.process(
    command(wallet, {
      kind: Kind.Win,
      referenceExternalTransactionId: bet.externalTransactionId,
    }),
    context(),
  );
  const refund = command(wallet, {
    kind: Kind.Refund,
    referenceExternalTransactionId: bet.externalTransactionId,
  });
  const applied = await service.process(refund, context());
  const duplicate = await service.process(
    { ...refund, externalTransactionId: unique(), idempotencyKey: unique() },
    context(),
  );
  await assertOutcome(win.transactionId, Status.Processed, true);
  await assertOutcome(applied.transactionId, Status.Processed, true);
  await assertOutcome(
    duplicate.transactionId,
    Status.Rejected,
    false,
    'REFERENCE_ALREADY_REVERSED',
  );
  await assertBalance(wallet, '125.00', 4, 4);
});

test.each([Kind.Bet, Kind.Win, Kind.Refund])(
  'ROLLBACK inverts a processed %s exactly once',
  async (kind) => {
    const wallet = await open();
    const bet = command(wallet);
    await service.process(bet, context());
    const reference =
      kind === Kind.Bet
        ? bet
        : command(wallet, {
            kind,
            ...(kind === Kind.Refund
              ? { referenceExternalTransactionId: bet.externalTransactionId }
              : {}),
          });
    if (kind !== Kind.Bet) await service.process(reference, context());
    const rollback = command(wallet, {
      kind: Kind.Rollback,
      referenceExternalTransactionId: reference.externalTransactionId,
    });
    const result = await service.process(rollback, context());
    const repeat = await service.process(
      {
        ...rollback,
        externalTransactionId: unique(),
        idempotencyKey: unique(),
      },
      context(),
    );
    await assertOutcome(result.transactionId, Status.Processed, true);
    await assertOutcome(
      repeat.transactionId,
      Status.Rejected,
      false,
      'REFERENCE_ALREADY_REVERSED',
    );
    await assertBalance(
      wallet,
      kind === Kind.Bet ? '100.00' : '75.00',
      kind === Kind.Bet ? 3 : 4,
      kind === Kind.Bet ? 3 : 4,
    );
  },
);

test('rollback of spent credit is rejected with its own stable code', async () => {
  const wallet = await open('0.00');
  const win = command(wallet, { kind: Kind.Win });
  await service.process(win, context());
  await service.process(command(wallet), context());
  const result = await service.process(
    command(wallet, {
      kind: Kind.Rollback,
      referenceExternalTransactionId: win.externalTransactionId,
    }),
    context(),
  );
  await assertOutcome(
    result.transactionId,
    Status.Rejected,
    false,
    'REVERSAL_INSUFFICIENT_FUNDS',
  );
  await assertBalance(wallet, '0.00', 3, 2);
});

test.each(['amount', 'round', 'kind', 'status'])(
  'invalid reference %s is auditable and does not change the wallet',
  async (fault) => {
    const wallet = await open();
    const reference = command(
      wallet,
      fault === 'kind'
        ? { kind: Kind.Win }
        : fault === 'status'
          ? { money: { amount: '200.00', currency: 'BRL' } }
          : {},
    );
    await service.process(reference, context());
    const result = await service.process(
      command(wallet, {
        kind: Kind.Refund,
        referenceExternalTransactionId: reference.externalTransactionId,
        ...(fault === 'amount'
          ? { money: { amount: '1.00', currency: 'BRL' } }
          : {}),
        ...(fault === 'round' ? { roundId: 'wrong-round' } : {}),
      }),
      context(),
    );
    const codes = {
      amount: 'REFERENCE_AMOUNT_MISMATCH',
      round: 'REFERENCE_SCOPE_MISMATCH',
      kind: 'REFERENCE_KIND_MISMATCH',
      status: 'REFERENCE_NOT_PROCESSED',
    } as const;
    await assertOutcome(
      result.transactionId,
      Status.Rejected,
      false,
      codes[fault as keyof typeof codes],
    );
    await assertBalance(
      wallet,
      fault === 'kind' ? '125.00' : fault === 'status' ? '100.00' : '75.00',
      fault === 'status' ? 1 : 2,
      fault === 'status' ? 1 : 2,
    );
  },
);

test('missing reference and same external ID from a different provider remain pending', async () => {
  const wallet = await open();
  const bet = command(wallet);
  await service.process(bet, context());
  const pending = await service.process(
    command(wallet, {
      providerId: 'another-provider',
      kind: Kind.Refund,
      referenceExternalTransactionId: bet.externalTransactionId,
    }),
    context(),
  );
  await assertOutcome(pending.transactionId, Status.PendingReference, false);
  await assertBalance(wallet, '75.00', 2, 2);
});

test('reference in another wallet is rejected without touching either balance', async () => {
  const first = await open();
  const second = await open();
  const bet = command(first);
  await service.process(bet, context());
  const result = await service.process(
    command(second, {
      kind: Kind.Refund,
      referenceExternalTransactionId: bet.externalTransactionId,
    }),
    context(),
  );
  await assertOutcome(
    result.transactionId,
    Status.Rejected,
    false,
    'REFERENCE_SCOPE_MISMATCH',
  );
  await assertBalance(first, '75.00', 2, 2);
  await assertBalance(second, '100.00', 1, 1);
});

test('matching identity replays; changed key or external identity conflicts without another effect', async () => {
  const wallet = await open();
  const input = command(wallet);
  const first = await service.process(input, context());
  expect(await service.process(input, context())).toEqual({
    ...first,
    idempotentReplay: true,
  });
  for (const repeated of [
    { ...input, idempotencyKey: unique() },
    { ...input, externalTransactionId: unique() },
  ]) {
    await expect(service.process(repeated, context())).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
  }
  await assertOutcome(first.transactionId, Status.Processed, true);
  await assertBalance(wallet, '75.00', 2, 2);
});

function faultUnit(
  after: (em: EntityManager) => Promise<void>,
): FinancialUnitOfWork {
  return {
    run: <T>(work: (session: FinancialSession) => Promise<T>) =>
      fixture.orm.em.fork().transactional(
        async (em) => {
          const result = await work(new MikroFinancialSession(em));
          await em.flush();
          await after(em);
          return result;
        },
        { isolationLevel: IsolationLevel.READ_COMMITTED },
      ),
  };
}

test.each(['opening', 'movement'])(
  'failure after flush rolls back %s including outbox',
  async (stage) => {
    const wallet = await open();
    const ctx = context();
    const input = command(wallet);
    const faulty = new FinancialProcessing(
      faultUnit(async () => {
        throw new Error('after flush');
      }),
      financialRuntime,
    );
    const playerId = unique();
    await expect(
      stage === 'opening'
        ? faulty.createWallet({ playerId, initialBalance: wallet.balance }, ctx)
        : faulty.process(input, ctx),
    ).rejects.toThrow('after flush');
    const em = fixture.orm.em.fork();
    expect(await em.count(WalletEntity, { playerId })).toBe(0);
    expect(
      await em.count(TransactionEntity, {
        externalTransactionId: input.externalTransactionId,
      }),
    ).toBe(0);
    expect(
      await em.count(OutboxEntity, {
        payload: { correlationId: ctx.correlationId },
      }),
    ).toBe(0);
    await assertBalance(wallet, '100.00', 1, 1);
  },
);

test('deferred failure at commit returns no success and rolls back all effects', async () => {
  const wallet = await open();
  const input = command(wallet);
  const ctx = context();
  const faulty = new FinancialProcessing(
    faultUnit(async (em) => {
      await sql(
        em,
        'update wallets set balance = 1, version = version + 1 where id = ?',
        [wallet.id],
      );
    }),
    financialRuntime,
  );
  await expectSqlFailure(() => faulty.process(input, ctx), '23514');
  expect(
    await fixture.orm.em
      .fork()
      .count(OutboxEntity, { payload: { correlationId: ctx.correlationId } }),
  ).toBe(0);
  expect(
    await fixture.orm.em.fork().count(TransactionEntity, {
      externalTransactionId: input.externalTransactionId,
    }),
  ).toBe(0);
  expect(
    await fixture.orm.em
      .fork()
      .count(ReceiptEntity, { idempotencyKey: input.idempotencyKey }),
  ).toBe(0);
  await assertBalance(wallet, '100.00', 1, 1);
});

test('missing wallet and structural invalid input cannot create financial rows', async () => {
  const wallet = await open();
  const ctx = context();
  await expect(
    service.process(command(wallet, { walletId: unique() }), ctx),
  ).rejects.toBeInstanceOf(WalletNotFoundError);
  await expect(
    service.process(
      command(wallet, { money: { amount: '0.001', currency: 'BRL' } }),
      ctx,
    ),
  ).rejects.toThrow('INVALID_MONEY');
  await expect(
    service.process(
      command(wallet, { kind: Kind.Opening as ProcessWagerCommand['kind'] }),
      ctx,
    ),
  ).rejects.toThrow('INVALID_INPUT');
  expect(
    await fixture.orm.em
      .fork()
      .count(OutboxEntity, { payload: { correlationId: ctx.correlationId } }),
  ).toBe(0);
  await assertBalance(wallet, '100.00', 1, 1);
});

async function hold(wallet: Opened) {
  const em = monitor.em.fork();
  await em.begin();
  await em.findOneOrFail(
    WalletEntity,
    { id: wallet.id },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
  );
  const [{ pid }] = (await sql(em, 'select pg_backend_pid() as pid')) as [
    { pid: number },
  ];
  return { pid, release: () => em.rollback() };
}
async function awaitBlocked(pid: number, count: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = (await sql(
      monitor.em.fork(),
      `with recursive blocked(pid) as (
         select ?::integer
         union
         select a.pid from pg_stat_activity a join blocked b on b.pid = any(pg_blocking_pids(a.pid))
       ) select pid from blocked where pid <> ?`,
      [pid, pid],
    )) as { pid: number }[];
    if (rows.length >= count) {
      expect(new Set(rows.map((row) => row.pid)).size).toBe(count);
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error(`Expected ${count} PostgreSQL sessions blocked by ${pid}`);
}
async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Independent wallet did not progress')),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('two real sessions betting 80 on 100 yield one debit and one rejection, with retry unable to duplicate', async () => {
  const wallet = await open();
  const blocker = await hold(wallet);
  const inputs = [
    command(wallet, { money: { amount: '80.00', currency: 'BRL' } }),
    command(wallet, { money: { amount: '80.00', currency: 'BRL' } }),
  ];
  const running = Promise.all(
    inputs.map((input) => service.process(input, context())),
  );
  try {
    await awaitBlocked(blocker.pid, 2);
  } finally {
    await blocker.release();
  }
  const results = await running;
  expect(results.map((result) => result.status).sort()).toEqual(
    [Status.Processed, Status.Rejected].sort(),
  );
  for (const result of results)
    await assertOutcome(
      result.transactionId,
      result.status,
      result.status === Status.Processed,
      result.failureCode,
    );
  for (const input of inputs)
    expect((await service.process(input, context())).idempotentReplay).toBe(
      true,
    );
  await assertBalance(wallet, '20.00', 2, 2);
});

test('a separate wallet commits while another operation waits for its wallet lock', async () => {
  const first = await open();
  const second = await open();
  const blocker = await hold(first);
  const waiting = service.process(command(first), context());
  let independent: Awaited<ReturnType<typeof service.process>>;
  try {
    await awaitBlocked(blocker.pid, 1);
    independent = await within(service.process(command(second), context()));
    await assertBalance(second, '75.00', 2, 2);
  } finally {
    await blocker.release();
  }
  const completed = await waiting;
  await assertOutcome(completed.transactionId, Status.Processed, true);
  await assertOutcome(independent.transactionId, Status.Processed, true);
  await assertBalance(first, '75.00', 2, 2);
});

test.each([Kind.Refund, Kind.Rollback])(
  'concurrent %s operations on one reference apply exactly once',
  async (kind) => {
    const wallet = await open();
    const bet = command(wallet);
    await service.process(bet, context());
    const blocker = await hold(wallet);
    const running = Promise.all(
      [0, 1].map(() =>
        service.process(
          command(wallet, {
            kind,
            referenceExternalTransactionId: bet.externalTransactionId,
          }),
          context(),
        ),
      ),
    );
    try {
      await awaitBlocked(blocker.pid, 2);
    } finally {
      await blocker.release();
    }
    const results = await running;
    expect(results.map((result) => result.status).sort()).toEqual(
      [Status.Processed, Status.Rejected].sort(),
    );
    for (const result of results)
      await assertOutcome(
        result.transactionId,
        result.status,
        result.status === Status.Processed,
        result.failureCode,
      );
    expect(
      results.find((result) => result.status === Status.Rejected)!.failureCode,
    ).toBe('REFERENCE_ALREADY_REVERSED');
    await assertBalance(wallet, '100.00', 3, 3);
  },
);

test('clock behind the stored wallet cannot move persisted time backwards', async () => {
  const wallet = await open();
  const delayedClock = new FinancialProcessing(
    {
      run: (work) =>
        fixture.orm.em
          .fork()
          .transactional((em) => work(new MikroFinancialSession(em))),
    },
    { ...financialRuntime, now: () => '2020-01-01T00:00:00.000Z' },
  );
  const result = await delayedClock.process(command(wallet), context());
  await assertOutcome(result.transactionId, Status.Processed, true);
  await assertBalance(wallet, '75.00', 2, 2);
});

test('schema upgrade preserves data and down never discards incompatible rejection audit', async () => {
  const isolated = await disposableDatabase();
  try {
    const migrator = isolated.orm.getMigrator();
    await migrator.up({ to: 'Migration202610140001' });
    const app = createFinancialProcessing(isolated.orm);
    const wallet = await app.createWallet(
      {
        playerId: unique(),
        initialBalance: { amount: '100.00', currency: 'BRL' },
      },
      context(),
    );
    await migrator.up({ to: 'Migration202610140002' });
    await migrator.down();
    expect(await migrator.getExecutedMigrations()).toHaveLength(1);
    await migrator.up();
    const rejection = await app.process(
      command(wallet, { money: { amount: '25.00', currency: 'USD' } }),
      context(),
    );
    await expectSqlFailure(
      () => migrator.down({ to: 'Migration202610140001' }),
      '23503',
    );
    expect(await migrator.getExecutedMigrations()).toHaveLength(5);
    const em = isolated.orm.em.fork();
    expect(
      (
        await em.findOneOrFail(TransactionEntity, {
          id: rejection.transactionId,
        })
      ).failureCode,
    ).toBe('CURRENCY_MISMATCH');
    expect(
      await em.count(OutboxEntity, { aggregateId: rejection.transactionId }),
    ).toBe(1);
    const result = await app.process(command(wallet), context());
    expect(result.balance.amount).toBe('75.00');
    const [reconciled] = (await sql(
      em,
      `select w.balance = (select sum(case direction when 'CREDIT' then amount else -amount end)
      from wallet_ledger_entries where wallet_id = w.id) as consistent from wallets w where w.id = ?`,
      [wallet.id],
    )) as [{ consistent: boolean }];
    expect(reconciled.consistent).toBe(true);
  } finally {
    await isolated.close();
  }
});
