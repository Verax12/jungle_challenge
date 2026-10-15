import { expect, test } from 'bun:test';
import {
  credit,
  disposableDatabase,
  ledger,
  later,
  expectSqlFailure,
  sql,
  transaction,
} from '../persistence/helpers.js';

test('SQL rejects a retroactive OPENING that breaks an existing ledger chain', async () => {
  const db = await disposableDatabase();
  try {
    await db.orm.getMigrator().up();
    const { id } = await credit(db.orm, '10.00');
    let sqlState: string | undefined;
    try {
      await db.orm.em.fork().transactional(async (em) => {
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
    } catch (error) {
      const failure = error as { code?: string; cause?: { code?: string } };
      sqlState = failure.code ?? failure.cause?.code;
    }
    const [result] = (await sql(
      db.orm.em,
      `select w.balance::text as stored, w.version,
        (select sum(case direction when 'CREDIT' then amount else -amount end)::text
        from wallet_ledger_entries where wallet_id=w.id) as calculated
       from wallets w where w.id=?`,
      [id],
    )) as [{ stored: string; calculated: string; version: number }];
    console.log(
      JSON.stringify({
        scenario: 'retroactive-opening',
        sqlState: sqlState ?? null,
        ...result,
      }),
    );
    expect(sqlState).toBe('23514');
    expect(result).toEqual({
      stored: '10.00',
      calculated: '10.00',
      version: 2,
    });
  } finally {
    await db.close();
  }
});

test.each(['amount', 'kind'] as const)(
  'SQL rejects reversal %s mismatch with otherwise consistent ledger arithmetic',
  async (mode) => {
    const db = await disposableDatabase();
    try {
      await db.orm.getMigrator().up();
      const { id, tx } = await credit(db.orm);
      const amount = mode === 'amount' ? '50.00' : '100.00';
      const after = mode === 'amount' ? '50.00' : '200.00';
      await expectSqlFailure(
        () =>
          db.orm.em.fork().transactional(async (em) => {
            const reversal = await transaction(em, {
              walletId: id,
              kind: mode === 'amount' ? 'ROLLBACK' : 'REFUND',
              amount,
              status: 'PROCESSED',
              reference: tx,
              referenceExternal: tx,
            });
            await sql(
              em,
              'update wallets set balance=?, version=3, updated_at=? where id=?',
              [after, later, id],
            );
            await ledger(em, {
              walletId: id,
              transactionId: reversal,
              amount,
              before: '100.00',
              after,
              version: 3,
              direction: mode === 'amount' ? 'DEBIT' : 'CREDIT',
            });
          }),
        '23514',
      );
      const rows = await sql(
        db.orm.em,
        'select balance::text, version from wallets where id=?',
        [id],
      );
      expect(rows).toEqual([{ balance: '100.00', version: 2 }]);
    } finally {
      await db.close();
    }
  },
);
