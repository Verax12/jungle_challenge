import { expect, test } from 'bun:test';
import {
  assertWalletsReconciled,
  credit,
  disposableDatabase,
  expectSqlFailure,
  ledger,
  later,
  raceTwoConnections,
  sql,
  transaction,
  unique,
  wallet,
  type Database,
} from './helpers.js';

const previous = 'Migration202610140004';
const current = 'Migration202610150001';

async function retroactiveOpening(orm: Database, id: string) {
  await orm.em.fork().transactional(async (em) => {
    const tx = await transaction(em, {
      walletId: id,
      kind: 'OPENING',
      amount: '5.00',
      status: 'PROCESSED',
    });
    await ledger(em, {
      walletId: id,
      transactionId: tx,
      amount: '5.00',
      before: '0.00',
      after: '5.00',
      version: 1,
    });
  });
}

async function snapshot(orm: Database) {
  return sql(
    orm.em.fork(),
    `select
      (select jsonb_agg(w order by id) from wallets w) as wallets,
      (select jsonb_agg(t order by id) from wager_transactions t) as transactions,
      (select jsonb_agg(e order by id) from wallet_ledger_entries e) as ledger`,
  );
}

async function openingAndWin(orm: Database) {
  const id = unique();
  await orm.em.fork().transactional(async (em) => {
    await sql(em, 'insert into wallets values (?, ?, ?, 5, 1, ?, ?)', [
      id,
      unique(),
      'BRL',
      later,
      later,
    ]);
    const opening = await transaction(em, {
      walletId: id,
      kind: 'OPENING',
      amount: '5.00',
      status: 'PROCESSED',
    });
    const win = await transaction(em, {
      walletId: id,
      kind: 'WIN',
      amount: '10.00',
      status: 'PROCESSED',
    });
    await sql(em, 'update wallets set balance=15, version=2 where id=?', [id]);
    await ledger(em, {
      walletId: id,
      transactionId: win,
      amount: '10.00',
      before: '5.00',
      after: '15.00',
      version: 2,
    });
    await ledger(em, {
      walletId: id,
      transactionId: opening,
      amount: '5.00',
      before: '0.00',
      after: '5.00',
      version: 1,
    });
  });
  return id;
}

test('ledger migration upgrades valid history, preserves all rows and supports down/up', async () => {
  const db = await disposableDatabase();
  try {
    const migrator = db.orm.getMigrator();
    await migrator.up({ to: previous });
    await wallet(db.orm.em);
    const { id } = await credit(db.orm, '10.00');
    await openingAndWin(db.orm);
    const before = await snapshot(db.orm);
    await migrator.up();
    await migrator.up();
    expect(await snapshot(db.orm)).toEqual(before);
    expect(await migrator.getExecutedMigrations()).toHaveLength(5);
    await expectSqlFailure(() => retroactiveOpening(db.orm, id), '23514');
    await migrator.down({ migrations: [current] });
    expect(await migrator.getExecutedMigrations()).toHaveLength(4);
    expect(
      await sql(
        db.orm.em,
        "select proname from pg_proc where proname='finance_ledger_successor_consistent'",
      ),
    ).toEqual([]);
    expect(await snapshot(db.orm)).toEqual(before);
    await migrator.up();
    await expectSqlFailure(() => retroactiveOpening(db.orm, id), '23514');
    expect(await snapshot(db.orm)).toEqual(before);
    await assertWalletsReconciled(db.orm.em);
  } finally {
    await db.close();
  }
});

test('ledger migration aborts on the old retroactive opening defect without rewriting history', async () => {
  const db = await disposableDatabase();
  try {
    const migrator = db.orm.getMigrator();
    await migrator.up({ to: previous });
    const { id } = await credit(db.orm, '10.00');
    await retroactiveOpening(db.orm, id);
    const before = await snapshot(db.orm);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(migrator.up()).rejects.toThrow(
        'existing ledger chain is inconsistent',
      );
      expect(await migrator.getExecutedMigrations()).toHaveLength(4);
      expect(
        (await migrator.getPendingMigrations()).map((m) => m.name),
      ).toEqual([current]);
      expect(await snapshot(db.orm)).toEqual(before);
      expect(
        await sql(
          db.orm.em,
          "select proname from pg_proc where proname='finance_ledger_successor_consistent'",
        ),
      ).toEqual([]);
    }
    await expectSqlFailure(
      () => sql(db.orm.em, 'update wallet_ledger_entries set amount=amount'),
      '23514',
    );
  } finally {
    await db.close();
  }
});

test('ledger migration refuses a previously corrupted wallet head without repairing it', async () => {
  const db = await disposableDatabase();
  try {
    const migrator = db.orm.getMigrator();
    await migrator.up({ to: previous });
    const { id } = await credit(db.orm, '10.00');
    await sql(
      db.orm.em,
      'alter table wallets disable trigger wallet_consistent',
    );
    try {
      await sql(
        db.orm.em,
        'update wallets set balance=11, version=3 where id=?',
        [id],
      );
    } finally {
      await sql(
        db.orm.em,
        'alter table wallets enable trigger wallet_consistent',
      );
    }
    const before = await snapshot(db.orm);
    await expect(migrator.up()).rejects.toThrow(
      'existing wallet and ledger diverge',
    );
    expect(await snapshot(db.orm)).toEqual(before);
    expect(await migrator.getExecutedMigrations()).toHaveLength(4);
  } finally {
    await db.close();
  }
});

test('deferred successor guard accepts a valid batch inserted in reverse version order', async () => {
  const db = await disposableDatabase();
  try {
    await db.orm.getMigrator().up();
    const id = await openingAndWin(db.orm);
    expect(
      await sql(
        db.orm.em,
        'select balance::text,version from wallets where id=?',
        [id],
      ),
    ).toEqual([{ balance: '15', version: 2 }]);
    await assertWalletsReconciled(db.orm.em);
  } finally {
    await db.close();
  }
});

test('concurrent valid credit and retroactive opening preserve the ledger chain', async () => {
  const db = await disposableDatabase();
  try {
    await db.orm.getMigrator().up();
    const { id } = await credit(db.orm, '10.00');
    let index = 0;
    const results = await raceTwoConnections(db.orm, async (em) => {
      const retroactive = index++ === 0;
      const tx = await transaction(em, {
        walletId: id,
        kind: retroactive ? 'OPENING' : 'WIN',
        amount: '5.00',
        status: 'PROCESSED',
      });
      if (!retroactive)
        await sql(
          em,
          'update wallets set balance=15, version=3, updated_at=? where id=?',
          [later, id],
        );
      await ledger(em, {
        walletId: id,
        transactionId: tx,
        amount: '5.00',
        before: retroactive ? '0.00' : '10.00',
        after: retroactive ? '5.00' : '15.00',
        version: retroactive ? 1 : 3,
      });
    });
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.reason.code ?? rejected?.reason.cause?.code).toBe('23514');
    expect(
      await sql(
        db.orm.em,
        'select balance::text,version from wallets where id=?',
        [id],
      ),
    ).toEqual([{ balance: '15', version: 3 }]);
    expect(
      await sql(
        db.orm.em,
        "select id from wager_transactions where kind='OPENING'",
      ),
    ).toEqual([]);
    await assertWalletsReconciled(db.orm.em);
  } finally {
    await db.close();
  }
});
