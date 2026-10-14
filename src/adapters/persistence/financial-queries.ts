import type { MikroORM } from '@mikro-orm/postgresql';
import type {
  FinancialQueries,
  TransactionView,
} from '../../application/ports/financial-queries.js';
import { TransactionNotFoundError } from '../../application/ports/financial-queries.js';
import { WalletNotFoundError } from '../../application/ports/financial-store.js';
import { DomainError, ensure } from '../../domain/errors.js';
import { WalletEntity, TransactionEntity, LedgerEntity } from './entities.js';
import type { TransactionRecord } from './entities.js';
import { transactionMapper } from './mappers.js';

function transactionView(record: TransactionRecord): TransactionView {
  const state = transactionMapper.toDomain(record).snapshot();
  return {
    id: state.id,
    providerId: state.providerId,
    externalTransactionId: state.externalTransactionId,
    walletId: state.walletId,
    playerId: state.playerId,
    roundId: state.roundId,
    gameId: state.gameId,
    kind: state.kind,
    money: state.money.toJSON(),
    status: state.status,
    failureCode: state.failureCode,
    createdAt: state.createdAt,
    processedAt: state.processedAt,
    referenceTransactionId: state.referenceTransactionId,
    ...(state.referenceExternalTransactionId === undefined
      ? {}
      : {
          referenceExternalTransactionId: state.referenceExternalTransactionId,
        }),
  };
}
export class MikroFinancialQueries implements FinancialQueries {
  constructor(private readonly orm: MikroORM) {}
  async wallet(id: string) {
    const wallet = await this.orm.em.fork().findOne(WalletEntity, { id });
    if (!wallet) throw new WalletNotFoundError();
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: { amount: wallet.balance, currency: wallet.currency },
      version: wallet.version,
    };
  }
  async transaction(id: string) {
    const record = await this.orm.em.fork().findOne(TransactionEntity, { id });
    if (!record) throw new TransactionNotFoundError();
    return transactionView(record);
  }
  async externalTransaction(providerId: string, externalTransactionId: string) {
    const record = await this.orm.em
      .fork()
      .findOne(TransactionEntity, { providerId, externalTransactionId });
    if (!record) throw new TransactionNotFoundError();
    return transactionView(record);
  }
  async ledger(walletId: string, cursor: string | undefined, limit: number) {
    ensure(Number.isInteger(limit) && limit >= 1 && limit <= 100);
    const wallet = await this.wallet(walletId);
    let after = 0;
    let through = wallet.version;
    if (cursor !== undefined) {
      try {
        ensure(cursor.length <= 2048 && /^[A-Za-z0-9_-]+$/.test(cursor));
        const raw = Buffer.from(cursor, 'base64url');
        ensure(raw.toString('base64url') === cursor);
        const data = JSON.parse(raw.toString('utf8')) as Record<
          string,
          unknown
        >;
        ensure(
          data &&
            typeof data === 'object' &&
            Object.keys(data).sort().join(',') === 'after,through,v,walletId',
        );
        ensure(data.v === 1 && data.walletId === walletId);
        ensure(
          typeof data.after === 'number' &&
            Number.isSafeInteger(data.after) &&
            data.after > 0,
        );
        ensure(
          typeof data.through === 'number' &&
            Number.isSafeInteger(data.through) &&
            data.through >= data.after &&
            data.through <= wallet.version,
        );
        after = data.after;
        through = data.through;
      } catch {
        throw DomainError.for('INVALID_INPUT');
      }
    }
    const rows = await this.orm.em
      .fork()
      .find(
        LedgerEntity,
        { walletId, walletVersion: { $gt: after, $lte: through } },
        { orderBy: { walletVersion: 'asc' }, limit: limit + 1 },
      );
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        walletId,
        transactionId: row.transactionId,
        direction: row.direction,
        money: { amount: row.amount, currency: row.currency },
        balanceBefore: { amount: row.balanceBefore, currency: row.currency },
        balanceAfter: { amount: row.balanceAfter, currency: row.currency },
        walletVersion: row.walletVersion,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > limit
          ? Buffer.from(
              JSON.stringify({
                v: 1,
                walletId,
                after: page.at(-1)!.walletVersion,
                through,
              }),
            ).toString('base64url')
          : null,
    };
  }
}
