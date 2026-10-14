import type { Wallet } from '../../domain/wallet.js';
import type {
  WagerTransaction,
  WagerTransactionKind,
} from '../../domain/wager-transaction.js';
import type { WalletLedgerEntry } from '../../domain/ledger.js';
import type { OutboxMessage } from '../../domain/messages.js';

export interface FinancialSession {
  lockWallet(id: string): Promise<Wallet | undefined>;
  findReference(
    providerId: string,
    externalId: string,
  ): Promise<WagerTransaction | undefined>;
  wasReversed(
    referenceId: string,
    kind: WagerTransactionKind,
  ): Promise<boolean>;
  insertWallet(wallet: Wallet): void;
  updateWallet(wallet: Wallet): void;
  insertTransaction(transaction: WagerTransaction): void;
  insertLedger(entry: WalletLedgerEntry, walletVersion: number): void;
  appendOutbox(message: OutboxMessage): void;
}
export interface FinancialUnitOfWork {
  run<T>(work: (session: FinancialSession) => Promise<T>): Promise<T>;
}
export interface FinancialRuntime {
  now(): string;
  newId(): string;
  hash(value: string): string;
}
export class FinancialConflictError extends Error {
  constructor(readonly resource: 'wallet' | 'transaction') {
    super(`Financial identity conflict: ${resource}`);
    this.name = 'FinancialConflictError';
  }
}
export class WalletNotFoundError extends Error {
  constructor() {
    super('Wallet not found');
    this.name = 'WalletNotFoundError';
  }
}
