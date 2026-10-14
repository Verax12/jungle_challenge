import { Wallet } from '../../domain/wallet.js';
import { WagerTransaction } from '../../domain/wager-transaction.js';
import { WalletLedgerEntry } from '../../domain/ledger.js';
import { InboxMessage, OutboxMessage } from '../../domain/messages.js';
import { Money } from '../../domain/money.js';
import type {
  InboxRecord,
  LedgerRecord,
  OutboxRecord,
  TransactionRecord,
  WalletRecord,
} from './entities.js';

export const walletMapper = {
  toRecord(wallet: Wallet): WalletRecord {
    const state = wallet.snapshot();
    return {
      ...state,
      balance: state.balance.toString(),
      createdAt: new Date(state.createdAt),
      updatedAt: new Date(state.updatedAt),
    };
  },
  toDomain(record: WalletRecord): Wallet {
    return Wallet.rehydrate({
      ...record,
      balance: Money.rehydrate({
        amount: record.balance,
        currency: record.currency,
      }),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    });
  },
};
export const transactionMapper = {
  toRecord(transaction: WagerTransaction): TransactionRecord {
    const { money, ...state } = transaction.snapshot();
    return {
      ...state,
      amount: money.toString(),
      currency: money.currency,
      referenceExternalTransactionId:
        state.referenceExternalTransactionId ?? null,
      referenceTransactionId: state.referenceTransactionId ?? null,
      failureCode: state.failureCode ?? null,
      createdAt: new Date(state.createdAt),
      processedAt: state.processedAt ? new Date(state.processedAt) : null,
    };
  },
  toDomain(record: TransactionRecord): WagerTransaction {
    const { amount, currency, referenceExternalTransactionId, ...state } =
      record;
    return WagerTransaction.rehydrate({
      ...state,
      money: Money.rehydrate({ amount, currency }),
      ...(referenceExternalTransactionId === null
        ? {}
        : { referenceExternalTransactionId }),
      referenceTransactionId: state.referenceTransactionId ?? undefined,
      failureCode: state.failureCode ?? undefined,
      createdAt: state.createdAt.toISOString(),
      processedAt: state.processedAt?.toISOString(),
    });
  },
};
export const ledgerMapper = {
  toRecord(entry: WalletLedgerEntry, walletVersion: number): LedgerRecord {
    const { money, balanceBefore, balanceAfter, ...state } = entry.snapshot();
    return {
      ...state,
      currency: money.currency,
      amount: money.toString(),
      balanceBefore: balanceBefore.toString(),
      balanceAfter: balanceAfter.toString(),
      walletVersion,
      createdAt: new Date(state.createdAt),
    };
  },
  toDomain(record: LedgerRecord): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: record.id,
      walletId: record.walletId,
      transactionId: record.transactionId,
      direction: record.direction,
      money: Money.rehydrate({
        amount: record.amount,
        currency: record.currency,
      }),
      balanceBefore: Money.rehydrate({
        amount: record.balanceBefore,
        currency: record.currency,
      }),
      balanceAfter: Money.rehydrate({
        amount: record.balanceAfter,
        currency: record.currency,
      }),
      createdAt: record.createdAt.toISOString(),
    });
  },
};
export const inboxMapper = {
  toRecord(message: InboxMessage): InboxRecord {
    const state = message.snapshot();
    return {
      ...state,
      receivedAt: new Date(state.receivedAt),
      processedAt: state.processedAt ? new Date(state.processedAt) : null,
    };
  },
  toDomain(record: InboxRecord): InboxMessage {
    return InboxMessage.rehydrate({
      ...record,
      receivedAt: record.receivedAt.toISOString(),
      processedAt: record.processedAt?.toISOString(),
    });
  },
};
export const outboxMapper = {
  toRecord(message: OutboxMessage): OutboxRecord {
    const state = message.snapshot();
    return {
      ...state,
      payload: JSON.parse(
        JSON.stringify(state.payload),
      ) as OutboxRecord['payload'],
      occurredAt: new Date(state.occurredAt),
      nextAttemptAt: state.nextAttemptAt ? new Date(state.nextAttemptAt) : null,
      publishedAt: state.publishedAt ? new Date(state.publishedAt) : null,
    };
  },
  toDomain(record: OutboxRecord): OutboxMessage {
    return OutboxMessage.rehydrate({
      ...record,
      occurredAt: record.occurredAt.toISOString(),
      nextAttemptAt: record.nextAttemptAt?.toISOString(),
      publishedAt: record.publishedAt?.toISOString(),
    });
  },
};
