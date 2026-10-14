import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  disposableDatabase,
  sql,
  wallet,
  transaction,
  ledger,
  credit,
  unique,
  at,
  later,
  expectSqlFailure,
  raceTwoConnections,
} from './helpers.js';

let fixture: Awaited<ReturnType<typeof disposableDatabase>>;
beforeAll(async () => {
  fixture = await disposableDatabase();
  await fixture.orm.getMigrator().up();
});
afterAll(async () => {
  await fixture?.close();
});

test('migration up is repeatable, down removes its objects, and up restores the schema', async () => {
  const other = await disposableDatabase();
  try {
    const migrator = other.orm.getMigrator();
    expect(await migrator.getPendingMigrations()).toHaveLength(1);
    await migrator.up();
    await migrator.up();
    expect(await migrator.getExecutedMigrations()).toHaveLength(1);
    expect(await migrator.getPendingMigrations()).toHaveLength(0);
    await migrator.down();
    expect(
      await sql(
        other.orm.em,
        "select tablename from pg_tables where schemaname = 'public' and tablename <> 'mikro_orm_migrations'",
      ),
    ).toEqual([]);
    expect(
      await sql(
        other.orm.em,
        "select typname from pg_type where typname = 'money_amount'",
      ),
    ).toEqual([]);
    expect(
      await sql(
        other.orm.em,
        "select proname from pg_proc where proname like 'finance_%'",
      ),
    ).toEqual([]);
    await migrator.up();
    await wallet(other.orm.em);
    expect(await migrator.getExecutedMigrations()).toHaveLength(1);
  } finally {
    await other.close();
  }
});

test.each([
  '-0.01',
  '0.001',
  '1.005',
  '1.000',
  'NaN',
  'Infinity',
  '-Infinity',
  '1000000000000000000000000000000000000.00',
])('SQL monetary domain rejects %s without silent rounding', async (amount) => {
  await expectSqlFailure(
    () => sql(fixture.orm.em, 'select ?::money_amount', [amount]),
    '23514',
  );
});
test('numeric upper boundary and fractional values stay exact strings', async () => {
  const amount = '999999999999999999999999999999999999.99';
  const rows = await sql(
    fixture.orm.em,
    'select ?::money_amount::text as amount',
    [amount],
  );
  expect(rows).toEqual([{ amount }]);
});
test('wallet uniqueness is enforced under two independent concurrent connections', async () => {
  const player = unique();
  const results = await raceTwoConnections(fixture.orm, (em) =>
    wallet(em, unique(), player),
  );
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  const rejected = results.find(
    (result) => result.status === 'rejected',
  ) as PromiseRejectedResult;
  expect((rejected.reason as { code: string }).code).toBe('23505');
  await wallet(fixture.orm.em, unique(), player, 'USD');
});
test('wallet cannot have a negative balance, invalid currency or initial version', async () => {
  const id = await wallet(fixture.orm.em);
  await expectSqlFailure(
    () =>
      sql(fixture.orm.em, 'update wallets set balance = -1 where id = ?', [id]),
    '23514',
  );
  await expectSqlFailure(
    () => wallet(fixture.orm.em, unique(), unique(), 'INVALID'),
    '23514',
  );
  await expectSqlFailure(
    () =>
      sql(fixture.orm.em, 'insert into wallets values (?, ?, ?, 0, 2, ?, ?)', [
        unique(),
        unique(),
        'BRL',
        at,
        at,
      ]),
    '23514',
  );
});
test('balance, version, identity and ledger consistency are enforced at commit', async () => {
  const id = await wallet(fixture.orm.em);
  for (const query of [
    'update wallets set balance = 1, version = 2 where id = ?',
    'update wallets set version = 2 where id = ?',
    'update wallets set balance = 1 where id = ?',
    "update wallets set player_id = 'other' where id = ?",
  ])
    await expectSqlFailure(() => sql(fixture.orm.em, query, [id]), '23514');
  expect(
    await sql(
      fixture.orm.em,
      'select balance::text, version from wallets where id = ?',
      [id],
    ),
  ).toEqual([{ balance: '0', version: 1 }]);
});
test.each([
  'update wallet_ledger_entries set amount = amount where id = ?',
  'delete from wallet_ledger_entries where id = ?',
])('ledger rejects direct mutation: %s', async (query) => {
  const { entry } = await credit(fixture.orm);
  await expectSqlFailure(() => sql(fixture.orm.em, query, [entry]), '23514');
});
test('TRUNCATE is forbidden even when all related audit tables are targeted', async () => {
  await expectSqlFailure(
    () =>
      sql(
        fixture.orm.em,
        'truncate wallets, wager_transactions, wallet_ledger_entries, inbox_messages, outbox_messages',
      ),
    '23514',
  );
});
test('ledger uniqueness rejects duplicate entries under concurrent insertion', async () => {
  const { id } = await credit(fixture.orm);
  const tx = await transaction(fixture.orm.em, { walletId: id });
  const results = await raceTwoConnections(fixture.orm, async (em) => {
    await sql(em, 'update wallets set balance = 75, version = 3 where id = ?', [
      id,
    ]);
    await sql(
      em,
      "update wager_transactions set status = 'PROCESSED', processed_at = ? where id = ?",
      [later, tx],
    );
    await ledger(em, {
      walletId: id,
      transactionId: tx,
      amount: '25.00',
      before: '100.00',
      after: '75.00',
      version: 3,
      direction: 'DEBIT',
    });
  });
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  const rejected = results.find(
    (result) => result.status === 'rejected',
  ) as PromiseRejectedResult;
  expect((rejected.reason as { code: string }).code).toBe('23505');
  expect(
    await sql(
      fixture.orm.em,
      'select balance::text, version from wallets where id = ?',
      [id],
    ),
  ).toEqual([{ balance: '75', version: 3 }]);
});
test('external identity and global idempotency key have independent constraints', async () => {
  const id = await wallet(fixture.orm.em);
  const external = unique();
  const key = unique();
  await transaction(fixture.orm.em, { walletId: id, external, key });
  await expectSqlFailure(
    () => transaction(fixture.orm.em, { walletId: id, external }),
    '23505',
  );
  await expectSqlFailure(
    () =>
      transaction(fixture.orm.em, { walletId: id, provider: 'another', key }),
    '23505',
  );
});
test.each(['PENDING', 'REJECTED', 'LOSS'])(
  'ledger cannot represent %s',
  async (mode) => {
    await expectSqlFailure(
      () =>
        fixture.orm.em.fork().transactional(async (em) => {
          const id = await wallet(em);
          const tx = await transaction(em, {
            walletId: id,
            kind: mode === 'LOSS' ? 'LOSS' : 'WIN',
            amount: mode === 'LOSS' ? '0.00' : '1.00',
            status: mode === 'LOSS' ? 'PROCESSED' : mode,
            ...(mode === 'REJECTED' ? { failure: 'INVALID_INPUT' } : {}),
          });
          await sql(
            em,
            'update wallets set balance = 1, version = 2 where id = ?',
            [id],
          );
          await ledger(em, {
            walletId: id,
            transactionId: tx,
            amount: '1.00',
            before: '0.00',
            after: '1.00',
            version: 2,
          });
        }),
      '23514',
    );
  },
);
test('processed financial transaction requires ledger while LOSS needs none', async () => {
  const id = await wallet(fixture.orm.em);
  await expectSqlFailure(
    () =>
      transaction(fixture.orm.em, {
        walletId: id,
        kind: 'WIN',
        status: 'PROCESSED',
      }),
    '23514',
  );
  await transaction(fixture.orm.em, {
    walletId: id,
    kind: 'LOSS',
    amount: '0.00',
    status: 'PROCESSED',
  });
});
test.each(['amount', 'direction', 'chain'])(
  'rejects inconsistent ledger %s',
  async (violation) => {
    const { id } = await credit(fixture.orm);
    await expectSqlFailure(
      () =>
        fixture.orm.em.fork().transactional(async (em) => {
          const tx = await transaction(em, {
            walletId: id,
            kind: 'WIN',
            amount: '25.00',
            status: 'PROCESSED',
          });
          const after = violation === 'direction' ? '75.00' : '126.00';
          await sql(
            em,
            'update wallets set balance = ?, version = 3 where id = ?',
            [after, id],
          );
          await ledger(em, {
            walletId: id,
            transactionId: tx,
            amount: violation === 'amount' ? '26.00' : '25.00',
            before: violation === 'chain' ? '101.00' : '100.00',
            after,
            version: 3,
            direction: violation === 'direction' ? 'DEBIT' : 'CREDIT',
          });
        }),
      '23514',
    );
  },
);
test('SQL cannot rewrite terminal transaction, payload, or wallet scope', async () => {
  const { id, tx } = await credit(fixture.orm);
  await expectSqlFailure(
    () =>
      sql(
        fixture.orm.em,
        "update wager_transactions set status = 'PENDING', processed_at = null where id = ?",
        [tx],
      ),
    '23514',
  );
  const pending = await transaction(fixture.orm.em, { walletId: id });
  await expectSqlFailure(
    () =>
      sql(
        fixture.orm.em,
        "update wager_transactions set payload_hash = 'changed' where id = ?",
        [pending],
      ),
    '23514',
  );
  await expectSqlFailure(
    () => transaction(fixture.orm.em, { walletId: id, currency: 'USD' }),
    '23503',
  );
});
test('reversal uniqueness survives two concurrent SQL transactions', async () => {
  const { id, tx } = await credit(fixture.orm, '100.00');
  const results = await raceTwoConnections(fixture.orm, async (em) => {
    await sql(em, 'select id from wallets where id = ? for update', [id]);
    const reverse = await transaction(em, {
      walletId: id,
      kind: 'ROLLBACK',
      amount: '100.00',
      status: 'PROCESSED',
      reference: tx,
      referenceExternal: tx,
    });
    await sql(em, 'update wallets set balance = 0, version = 3 where id = ?', [
      id,
    ]);
    await ledger(em, {
      walletId: id,
      transactionId: reverse,
      amount: '100.00',
      before: '100.00',
      after: '0.00',
      version: 3,
      direction: 'DEBIT',
    });
  });
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  const rejected = results.find(
    (result) => result.status === 'rejected',
  ) as PromiseRejectedResult;
  expect((rejected.reason as { code: string }).code).toBe('23505');
  await transaction(fixture.orm.em, {
    walletId: id,
    kind: 'ROLLBACK',
    amount: '100.00',
    referenceExternal: tx,
    status: 'REJECTED',
    failure: 'REFERENCE_ALREADY_REVERSED',
  });
});
test.each(['scope', 'amount', 'kind', 'missing'])(
  'reference %s is checked by PostgreSQL',
  async (violation) => {
    const { id, tx } = await credit(fixture.orm);
    await expectSqlFailure(
      () =>
        fixture.orm.em.fork().transactional(async (em) => {
          const amount = violation === 'amount' ? '50.00' : '100.00';
          const reverse = await transaction(em, {
            walletId: id,
            kind: violation === 'kind' ? 'REFUND' : 'ROLLBACK',
            amount,
            status: 'PROCESSED',
            reference: violation === 'missing' ? unique() : tx,
            referenceExternal: tx,
            ...(violation === 'scope' ? { provider: 'other' } : {}),
          });
          await sql(
            em,
            'update wallets set balance = 0, version = 3 where id = ?',
            [id],
          );
          await ledger(em, {
            walletId: id,
            transactionId: reverse,
            amount: '100.00',
            before: '100.00',
            after: '0.00',
            version: 3,
            direction: 'DEBIT',
          });
        }),
      violation === 'missing' ? '23503' : '23514',
    );
  },
);
test('inbox dedup and immutable identity persist in the database', async () => {
  const message = unique();
  await sql(
    fixture.orm.em,
    'insert into inbox_messages values (?, ?, ?, ?, null)',
    ['consumer', message, 'hash', at],
  );
  await expectSqlFailure(
    () =>
      sql(
        fixture.orm.em,
        'insert into inbox_messages values (?, ?, ?, ?, null)',
        ['consumer', message, 'hash', at],
      ),
    '23505',
  );
  await sql(
    fixture.orm.em,
    'insert into inbox_messages values (?, ?, ?, ?, null)',
    ['other-consumer', message, 'hash', at],
  );
  await expectSqlFailure(
    () =>
      sql(
        fixture.orm.em,
        "update inbox_messages set payload_hash = 'changed' where message_id = ?",
        [message],
      ),
    '23514',
  );
  await sql(
    fixture.orm.em,
    'update inbox_messages set processed_at = ? where message_id = ?',
    [later, message],
  );
  await expectSqlFailure(
    () =>
      sql(
        fixture.orm.em,
        'update inbox_messages set processed_at = null where message_id = ?',
        [message],
      ),
    '23514',
  );
});
