import { EntitySchema } from '@mikro-orm/core';
import type { FailureCode } from '../../domain/errors.js';
import type { LedgerDirection } from '../../domain/ledger.js';
import type { JsonValue } from '../../domain/values.js';
import type {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wager-transaction.js';
import { ExactAmountType } from './amount-type.js';

export interface WalletRecord {
  id: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface TransactionRecord {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  currency: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  amount: string;
  referenceExternalTransactionId: string | null;
  referenceTransactionId: string | null;
  status: WagerTransactionStatus;
  failureCode: FailureCode | null;
  createdAt: Date;
  processedAt: Date | null;
}
export interface LedgerRecord {
  id: string;
  walletId: string;
  transactionId: string;
  currency: string;
  direction: LedgerDirection;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  walletVersion: number;
  createdAt: Date;
}
export interface InboxRecord {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt: Date | null;
}
export interface OutboxRecord {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: JsonValue;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date | null;
  publishedAt: Date | null;
}

const id = { type: 'string', columnType: 'financial_id' } as const;
const currency = { type: 'string', columnType: 'financial_currency' } as const;
const amount = { type: ExactAmountType } as const;
const date = { type: Date, columnType: 'timestamptz' } as const;
export const WalletEntity = new EntitySchema<WalletRecord>({
  name: 'WalletRecord',
  tableName: 'wallets',
  properties: {
    id: { ...id, primary: true },
    playerId: id,
    currency,
    balance: amount,
    version: { type: 'integer' },
    createdAt: date,
    updatedAt: date,
  },
});
export const TransactionEntity = new EntitySchema<TransactionRecord>({
  name: 'TransactionRecord',
  tableName: 'wager_transactions',
  properties: {
    id: { ...id, primary: true },
    providerId: id,
    externalTransactionId: id,
    idempotencyKey: id,
    payloadHash: id,
    walletId: id,
    playerId: id,
    currency,
    roundId: id,
    gameId: id,
    kind: { type: 'string' },
    amount,
    referenceExternalTransactionId: { ...id, nullable: true },
    referenceTransactionId: { ...id, nullable: true },
    status: { type: 'string' },
    failureCode: { type: 'string', nullable: true },
    createdAt: date,
    processedAt: { ...date, nullable: true },
  },
});
export const LedgerEntity = new EntitySchema<LedgerRecord>({
  name: 'LedgerRecord',
  tableName: 'wallet_ledger_entries',
  properties: {
    id: { ...id, primary: true },
    walletId: id,
    transactionId: id,
    currency,
    direction: { type: 'string' },
    amount,
    balanceBefore: amount,
    balanceAfter: amount,
    walletVersion: { type: 'integer' },
    createdAt: date,
  },
});
export const InboxEntity = new EntitySchema<InboxRecord>({
  name: 'InboxRecord',
  tableName: 'inbox_messages',
  properties: {
    consumerName: { ...id, primary: true },
    messageId: { ...id, primary: true },
    payloadHash: id,
    receivedAt: date,
    processedAt: { ...date, nullable: true },
  },
});
export const OutboxEntity = new EntitySchema<OutboxRecord>({
  name: 'OutboxRecord',
  tableName: 'outbox_messages',
  properties: {
    id: { ...id, primary: true },
    aggregateId: id,
    eventType: id,
    payload: { type: 'json' },
    occurredAt: date,
    attempts: { type: 'integer' },
    nextAttemptAt: { ...date, nullable: true },
    publishedAt: { ...date, nullable: true },
  },
});
export const entities = [
  WalletEntity,
  TransactionEntity,
  LedgerEntity,
  InboxEntity,
  OutboxEntity,
];
