import { newReferenceJob, nextReferenceAttempt } from './reference-schedule.js';
import { canonicalJson, replay } from './idempotency.js';
import type { ProcessingResult } from './idempotency.js';
import { FinancialConflictError } from './ports/financial-store.js';
import { DomainError, ensure } from '../domain/errors.js';
import { Money } from '../domain/money.js';
import type { MoneyProps } from '../domain/money.js';
import { Wallet } from '../domain/wallet.js';
import {
  WagerTransaction,
  WagerTransactionStatus,
} from '../domain/wager-transaction.js';
import type { CreateWagerTransactionProps } from '../domain/wager-transaction.js';
import type { WalletLedgerEntry } from '../domain/ledger.js';
import { InboxMessage, OutboxMessage } from '../domain/messages.js';
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionPendingReference,
  WalletBalanceChanged,
} from '../domain/events.js';
import { identifier, instant } from '../domain/values.js';
import type {
  FinancialUnitOfWork,
  FinancialSession,
  FinancialRuntime,
  InboxDelivery,
} from './ports/financial-store.js';
import { WalletNotFoundError } from './ports/financial-store.js';

export interface ProcessingContext {
  readonly correlationId: string;
  readonly causationId?: string;
}
export type ProcessWagerCommand = Omit<
  CreateWagerTransactionProps,
  'id' | 'createdAt' | 'money' | 'payloadHash'
> & {
  readonly money: MoneyProps;
};
function validateContext(context: ProcessingContext): void {
  identifier(context.correlationId);
  if (context.causationId !== undefined) identifier(context.causationId);
}
export class FinancialProcessing {
  constructor(
    private readonly unit: FinancialUnitOfWork,
    private readonly runtime: FinancialRuntime,
  ) {}

  async createWallet(
    command: { playerId: string; initialBalance: MoneyProps },
    context: ProcessingContext,
  ) {
    validateContext(context);
    const initialBalance = Money.from(command.initialBalance);
    const id = this.runtime.newId();
    const model = Wallet.open({
      id,
      playerId: command.playerId,
      initialBalance,
      at: this.runtime.now(),
      ...(initialBalance.isZero()
        ? {}
        : {
            opening: {
              transactionId: this.runtime.newId(),
              entryId: this.runtime.newId(),
              payloadHash: this.runtime.hash(
                JSON.stringify({
                  walletId: id,
                  playerId: command.playerId,
                  initialBalance: initialBalance.toJSON(),
                }),
              ),
            },
          }),
    });
    return this.unit.run(async (session) => {
      session.insertWallet(model.wallet);
      if (model.opening) {
        session.insertTransaction(model.opening.transaction);
        session.insertLedger(model.opening.entry, model.wallet.version);
        this.recordEvents(
          session,
          model.wallet,
          model.opening.transaction,
          model.opening.entry,
          context,
          model.wallet.createdAt,
        );
      }
      return {
        id,
        playerId: model.wallet.playerId,
        balance: model.wallet.balance.toJSON(),
        version: model.wallet.version,
      };
    });
  }

  async process(
    command: ProcessWagerCommand,
    context: ProcessingContext,
    delivery?: InboxDelivery,
  ) {
    validateContext(context);
    const payloadHash = this.runtime.hash(
      canonicalJson({
        providerId: command.providerId,
        externalTransactionId: command.externalTransactionId,
        walletId: command.walletId,
        playerId: command.playerId,
        roundId: command.roundId,
        gameId: command.gameId,
        kind: command.kind,
        money: {
          amount: command.money.amount,
          currency: command.money.currency,
        },
        ...(command.referenceExternalTransactionId === undefined
          ? {}
          : {
              referenceExternalTransactionId:
                command.referenceExternalTransactionId,
            }),
      }),
    );
    const transaction = WagerTransaction.create({
      ...command,
      payloadHash,
      id: this.runtime.newId(),
      createdAt: this.runtime.now(),
      money: Money.from(command.money),
    });
    try {
      return await this.request(delivery, async (session) => {
        const existing = replay(
          await session.findReceipts(command),
          command,
          payloadHash,
        );
        if (existing) return { ...existing, idempotentReplay: true };
        const wallet = await session.lockWallet(transaction.walletId);
        if (!wallet) throw new WalletNotFoundError();
        const concurrent = replay(
          await session.findReceipts(command),
          command,
          payloadHash,
        );
        if (concurrent) return { ...concurrent, idempotentReplay: true };
        const now = this.runtime.now();
        instant(now);
        const at = [now, wallet.updatedAt, transaction.createdAt]
          .sort()
          .at(-1)!;
        const entry = await this.apply(session, wallet, transaction, at);
        session.insertTransaction(transaction);
        if (transaction.status === WagerTransactionStatus.PendingReference)
          session.scheduleReference(
            newReferenceJob(transaction.id, transaction.createdAt, context),
          );
        this.recordEvents(session, wallet, transaction, entry, context, at);
        const result: ProcessingResult = {
          transactionId: transaction.id,
          status: transaction.status,
          ...(transaction.failureCode
            ? { failureCode: transaction.failureCode }
            : {}),
          balance: wallet.balance.toJSON(),
          walletVersion: wallet.version,
        };
        session.insertReceipt({
          idempotencyKey: command.idempotencyKey,
          providerId: command.providerId,
          externalTransactionId: command.externalTransactionId,
          payloadHash,
          result,
        });
        return { ...result, idempotentReplay: false };
      });
    } catch (error) {
      if (
        !(error instanceof FinancialConflictError) ||
        error.resource !== 'transaction'
      )
        throw error;
      return this.request(delivery, async (session) => {
        const committed = replay(
          await session.findReceipts(command),
          command,
          payloadHash,
        );
        if (!committed) throw error;
        return { ...committed, idempotentReplay: true };
      });
    }
  }

  private request<T>(
    delivery: InboxDelivery | undefined,
    work: (session: FinancialSession) => Promise<T>,
  ): Promise<T> {
    return this.unit.run(async (session) => {
      const inbox = delivery
        ? await session.receiveInbox(
            InboxMessage.receive({
              ...delivery,
              receivedAt: this.runtime.now(),
            }),
          )
        : undefined;
      if (inbox && delivery) inbox.assertPayload(delivery.payloadHash);
      const result = await work(session);
      if (inbox && !inbox.isProcessed()) {
        inbox.markProcessed(
          [this.runtime.now(), inbox.receivedAt].sort().at(-1)!,
        );
        session.completeInbox(inbox);
      }
      return result;
    });
  }

  async retryReference() {
    return this.unit.run(async (session) => {
      const claimed = await session.claimReference(this.runtime.now());
      if (!claimed) return undefined;
      const { job, transaction, wallet } = claimed;
      const now = this.runtime.now();
      instant(now);
      const at = [now, wallet.updatedAt, transaction.createdAt].sort().at(-1)!;
      let entry: WalletLedgerEntry | undefined;
      if (now >= job.expiresAt) transaction.reject('REFERENCE_NOT_FOUND');
      else entry = await this.apply(session, wallet, transaction, at);
      job.attempts++;
      if (transaction.status === WagerTransactionStatus.PendingReference) {
        job.nextAttemptAt = nextReferenceAttempt(
          now,
          job.attempts,
          job.expiresAt,
        );
      } else {
        job.completedAt = at;
        session.updateTransaction(transaction);
        this.recordEvents(
          session,
          wallet,
          transaction,
          entry,
          {
            correlationId: job.correlationId,
            ...(job.causationId === null
              ? {}
              : { causationId: job.causationId }),
          },
          at,
        );
      }
      session.updateReference(job);
      return {
        transactionId: transaction.id,
        walletId: wallet.id,
        providerId: transaction.providerId,
        correlationId: job.correlationId,
        status: transaction.status,
        attempts: job.attempts,
      };
    });
  }

  private async apply(
    session: FinancialSession,
    wallet: Wallet,
    transaction: WagerTransaction,
    at: string,
  ) {
    const reference =
      transaction.referenceExternalTransactionId === undefined
        ? undefined
        : await session.findReference(
            transaction.providerId,
            transaction.referenceExternalTransactionId,
          );
    const alreadyReversed =
      reference && transaction.requiresReference()
        ? await session.wasReversed(reference.id, transaction.kind)
        : false;
    let entry: WalletLedgerEntry | undefined;
    try {
      ensure(wallet.playerId === transaction.playerId, 'WALLET_MISMATCH');
      ensure(
        wallet.currency === transaction.money.currency,
        'CURRENCY_MISMATCH',
      );
      entry = wallet.apply(transaction, {
        entryId: this.runtime.newId(),
        at,
        alreadyReversed,
        ...(reference ? { reference } : {}),
      });
    } catch (error) {
      if (
        !(error instanceof DomainError) ||
        error.code === 'INVALID_INPUT' ||
        error.code === 'INFRASTRUCTURE_PERMANENT'
      )
        throw error;
      if (error.code === 'REFERENCE_NOT_FOUND')
        transaction.markPendingReference();
      else transaction.reject(error.code);
    }
    if (entry) {
      session.updateWallet(wallet);
      session.insertLedger(entry, wallet.version);
    }
    return entry;
  }

  private recordEvents(
    session: FinancialSession,
    wallet: Wallet,
    transaction: WagerTransaction,
    entry: WalletLedgerEntry | undefined,
    context: ProcessingContext,
    at: string,
  ): void {
    const eventContext = () => ({
      ...context,
      eventId: this.runtime.newId(),
      occurredAt: at,
    });
    const event =
      transaction.status === WagerTransactionStatus.Processed
        ? WagerTransactionProcessed.from(transaction, eventContext())
        : transaction.status === WagerTransactionStatus.Rejected
          ? WagerTransactionRejected.from(transaction, eventContext())
          : WagerTransactionPendingReference.from(transaction, eventContext());
    session.appendOutbox(OutboxMessage.enqueue(event));
    if (entry)
      session.appendOutbox(
        OutboxMessage.enqueue(
          WalletBalanceChanged.from(wallet, entry, eventContext()),
        ),
      );
  }
}
