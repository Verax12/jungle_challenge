import type {
  ProcessingReceipt,
  RequestIdentity,
} from '../../application/idempotency.js';
import { ReceiptEntity } from './entities.js';
import {
  IsolationLevel,
  LockMode,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type {
  FinancialSession,
  FinancialUnitOfWork,
} from '../../application/ports/financial-store.js';
import { FinancialConflictError } from '../../application/ports/financial-store.js';
import type { Wallet } from '../../domain/wallet.js';
import { WagerTransactionStatus } from '../../domain/wager-transaction.js';
import type {
  WagerTransaction,
  WagerTransactionKind,
} from '../../domain/wager-transaction.js';
import type { WalletLedgerEntry } from '../../domain/ledger.js';
import type { OutboxMessage } from '../../domain/messages.js';
import {
  WalletEntity,
  TransactionEntity,
  LedgerEntity,
  OutboxEntity,
} from './entities.js';
import type { WalletRecord } from './entities.js';
import {
  walletMapper,
  transactionMapper,
  ledgerMapper,
  outboxMapper,
} from './mappers.js';

export class MikroFinancialSession implements FinancialSession {
  private readonly lockedWallets = new Map<string, WalletRecord>();
  constructor(private readonly em: EntityManager) {}
  async findReceipts(identity: RequestIdentity): Promise<ProcessingReceipt[]> {
    const rows = await this.em.find(
      ReceiptEntity,
      {
        $or: [
          { idempotencyKey: identity.idempotencyKey },
          {
            providerId: identity.providerId,
            externalTransactionId: identity.externalTransactionId,
          },
        ],
      },
      { refresh: true },
    );
    return rows.map((row) => ({
      idempotencyKey: row.idempotencyKey,
      providerId: row.providerId,
      externalTransactionId: row.externalTransactionId,
      payloadHash: row.payloadHash,
      result: {
        transactionId: row.transactionId,
        status: row.status,
        balance: { amount: row.balance, currency: row.currency },
        walletVersion: row.walletVersion,
        ...(row.failureCode ? { failureCode: row.failureCode } : {}),
      },
    }));
  }
  insertReceipt(receipt: ProcessingReceipt): void {
    this.em.create(ReceiptEntity, {
      transactionId: receipt.result.transactionId,
      idempotencyKey: receipt.idempotencyKey,
      providerId: receipt.providerId,
      externalTransactionId: receipt.externalTransactionId,
      payloadHash: receipt.payloadHash,
      status: receipt.result.status,
      balance: receipt.result.balance.amount,
      currency: receipt.result.balance.currency,
      walletVersion: receipt.result.walletVersion,
      failureCode: receipt.result.failureCode ?? null,
    });
  }
  async lockWallet(id: string) {
    const record = await this.em.findOne(
      WalletEntity,
      { id },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    );
    if (!record) return undefined;
    this.lockedWallets.set(id, record);
    return walletMapper.toDomain(record);
  }
  async findReference(providerId: string, externalTransactionId: string) {
    const record = await this.em.findOne(TransactionEntity, {
      providerId,
      externalTransactionId,
    });
    return record ? transactionMapper.toDomain(record) : undefined;
  }
  async wasReversed(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ) {
    return (
      (await this.em.count(TransactionEntity, {
        referenceTransactionId,
        kind,
        status: WagerTransactionStatus.Processed,
      })) > 0
    );
  }
  insertWallet(wallet: Wallet): void {
    this.em.create(WalletEntity, walletMapper.toRecord(wallet));
  }
  updateWallet(wallet: Wallet): void {
    const record = this.lockedWallets.get(wallet.id);
    if (!record) throw new Error('Wallet must be locked before update');
    this.em.assign(record, walletMapper.toRecord(wallet));
  }
  insertTransaction(transaction: WagerTransaction): void {
    this.em.create(TransactionEntity, transactionMapper.toRecord(transaction));
  }
  insertLedger(entry: WalletLedgerEntry, walletVersion: number): void {
    this.em.create(LedgerEntity, ledgerMapper.toRecord(entry, walletVersion));
  }
  appendOutbox(message: OutboxMessage): void {
    this.em.create(OutboxEntity, outboxMapper.toRecord(message));
  }
}
export class MikroFinancialUnitOfWork implements FinancialUnitOfWork {
  constructor(private readonly orm: MikroORM) {}
  async run<T>(work: (session: FinancialSession) => Promise<T>): Promise<T> {
    try {
      return await this.orm.em
        .fork({ useContext: false })
        .transactional((em) => work(new MikroFinancialSession(em)), {
          isolationLevel: IsolationLevel.READ_COMMITTED,
        });
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        const constraint = (error as { constraint?: string }).constraint;
        if (constraint === 'wallets_identity')
          throw new FinancialConflictError('wallet');
        if (
          constraint === 'transactions_external' ||
          constraint === 'wager_transactions_idempotency_key_key' ||
          constraint === 'processing_receipts_idempotency_key_key' ||
          constraint === 'receipts_external'
        )
          throw new FinancialConflictError('transaction');
      }
      throw error;
    }
  }
}
