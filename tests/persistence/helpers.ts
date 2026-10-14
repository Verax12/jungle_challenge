import { randomUUID } from 'node:crypto';
import { expect } from 'bun:test';
import type { EntityManager } from '@mikro-orm/postgresql';
import { loadConfig } from '../../src/adapters/config/environment.js';
import { connectDatabase } from '../../src/adapters/persistence/database.js';

export const at = '2026-10-14T12:00:00.000Z';
export const later = '2026-10-14T12:00:01.000Z';
export const unique = () => randomUUID();
export type Database = Awaited<ReturnType<typeof connectDatabase>>;

export async function disposableDatabase() {
  const config = loadConfig(process.env).database;
  if (!['127.0.0.1', 'localhost', 'postgres'].includes(config.host))
    throw new Error('Persistence tests require a local PostgreSQL host.');
  const name = `challenge_test_${randomUUID().replaceAll('-', '')}`;
  const admin = await connectDatabase(config);
  let orm: Database | undefined;
  try {
    await admin.em.getConnection().execute(`create database "${name}"`);
    orm = await connectDatabase({ ...config, name });
  } catch (error) {
    await admin.em
      .getConnection()
      .execute(`drop database if exists "${name}"`)
      .finally(() => admin.close(true));
    throw error;
  }
  const database = orm;
  return {
    orm: database,
    name,
    async close() {
      await database.close(true);
      try {
        await admin.em.getConnection().execute(`drop database "${name}"`);
      } finally {
        await admin.close(true);
      }
    },
  };
}

export async function sql(
  em: EntityManager,
  query: string,
  params: unknown[] = [],
) {
  return em
    .getConnection()
    .execute(query, params, 'all', em.getTransactionContext());
}
export async function wallet(
  em: EntityManager,
  id = unique(),
  player = unique(),
  currency = 'BRL',
) {
  await sql(em, 'insert into wallets values (?, ?, ?, 0, 1, ?, ?)', [
    id,
    player,
    currency,
    at,
    at,
  ]);
  return id;
}
export interface TxOptions {
  id?: string;
  walletId: string;
  kind?: string;
  amount?: string;
  status?: string;
  provider?: string;
  external?: string;
  key?: string;
  reference?: string | null;
  referenceExternal?: string | null;
  failure?: string | null;
  currency?: string;
  round?: string;
}
export async function transaction(em: EntityManager, options: TxOptions) {
  const id = options.id ?? unique();
  const status = options.status ?? 'PENDING';
  const [w] = (await sql(
    em,
    'select player_id, currency from wallets where id = ?',
    [options.walletId],
  )) as { player_id: string; currency: string }[];
  await sql(
    em,
    `insert into wager_transactions
    (id,provider_id,external_transaction_id,idempotency_key,payload_hash,wallet_id,player_id,currency,round_id,game_id,kind,amount,
    reference_external_transaction_id,reference_transaction_id,status,failure_code,created_at,processed_at)
    values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      options.provider ?? 'provider',
      options.external ?? id,
      options.key ?? id,
      'hash',
      options.walletId,
      w!.player_id,
      options.currency ?? w!.currency,
      options.round ?? 'round',
      'game',
      options.kind ?? 'BET',
      options.amount ?? '25.00',
      options.referenceExternal ?? null,
      options.reference ?? null,
      status,
      options.failure ?? null,
      at,
      status === 'PROCESSED' ? later : null,
    ],
  );
  return id;
}
export async function ledger(
  em: EntityManager,
  options: {
    walletId: string;
    transactionId: string;
    amount: string;
    before: string;
    after: string;
    version: number;
    direction?: string;
    id?: string;
    currency?: string;
  },
) {
  const id = options.id ?? unique();
  await sql(
    em,
    'insert into wallet_ledger_entries values (?,?,?,?,?,?,?,?,?,?)',
    [
      id,
      options.walletId,
      options.transactionId,
      options.currency ?? 'BRL',
      options.direction ?? 'CREDIT',
      options.amount,
      options.before,
      options.after,
      options.version,
      later,
    ],
  );
  return id;
}
export async function credit(orm: Database, amount = '100.00') {
  let id = '';
  let tx = '';
  let entry = '';
  await orm.em.fork().transactional(async (em) => {
    id = await wallet(em);
    tx = await transaction(em, {
      walletId: id,
      kind: 'WIN',
      amount,
      status: 'PROCESSED',
    });
    await sql(
      em,
      'update wallets set balance = ?, version = 2, updated_at = ? where id = ?',
      [amount, later, id],
    );
    entry = await ledger(em, {
      walletId: id,
      transactionId: tx,
      amount,
      before: '0.00',
      after: amount,
      version: 2,
    });
  });
  return { id, tx, entry };
}
export async function expectSqlFailure(
  action: () => Promise<unknown>,
  code: string,
) {
  try {
    await action();
    throw new Error(`Expected SQLSTATE ${code}`);
  } catch (error) {
    const actual = error as { code?: string; cause?: { code?: string } };
    expect(actual.code ?? actual.cause?.code).toBe(code);
  }
}

export async function raceTwoConnections(
  orm: Database,
  work: (em: EntityManager) => Promise<unknown>,
) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pids = new Set<number>();
  const results = await Promise.allSettled(
    [0, 1].map(() =>
      orm.em.fork().transactional(async (em) => {
        const [{ pid }] = (await sql(em, 'select pg_backend_pid() as pid')) as [
          { pid: number },
        ];
        pids.add(pid);
        if (pids.size === 2) release();
        await gate;
        return work(em);
      }),
    ),
  );
  expect(pids.size).toBe(2);
  return results;
}
