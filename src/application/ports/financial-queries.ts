import type { MoneyProps } from '../../domain/money.js';
import type { WagerTransactionState } from '../../domain/wager-transaction.js';

export interface WalletView {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}
export type TransactionView = Omit<
  WagerTransactionState,
  'money' | 'payloadHash' | 'idempotencyKey'
> & { money: MoneyProps };
export interface LedgerView {
  id: string;
  walletId: string;
  transactionId: string;
  direction: string;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
  createdAt: string;
}
import type { reconcileWallet } from '../reconcile-wallet.js';
export interface FinancialQueries {
  reconciliation(
    walletId: string,
    context?: { correlationId: string },
  ): Promise<ReturnType<typeof reconcileWallet>>;
  wallet(id: string): Promise<WalletView>;
  transaction(id: string): Promise<TransactionView>;
  externalTransaction(
    providerId: string,
    externalId: string,
  ): Promise<TransactionView>;
  ledger(
    walletId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ items: LedgerView[]; nextCursor: string | null }>;
}
export class TransactionNotFoundError extends Error {
  constructor() {
    super('Transaction not found');
    this.name = 'TransactionNotFoundError';
  }
}
