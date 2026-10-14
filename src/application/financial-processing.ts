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
import { OutboxMessage } from '../domain/messages.js';
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
} from './ports/financial-store.js';
import { WalletNotFoundError } from './ports/financial-store.js';

export interface ProcessingContext {
  readonly correlationId: string;
  readonly causationId?: string;
}
export type ProcessWagerCommand = Omit<
  CreateWagerTransactionProps,
  'id' | 'createdAt' | 'money'
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

  async process(command: ProcessWagerCommand, context: ProcessingContext) {
    validateContext(context);
    const transaction = WagerTransaction.create({
      ...command,
      id: this.runtime.newId(),
      createdAt: this.runtime.now(),
      money: Money.from(command.money),
    });
    return this.unit.run(async (session) => {
      const wallet = await session.lockWallet(transaction.walletId);
      if (!wallet) throw new WalletNotFoundError();
      const now = this.runtime.now();
      instant(now);
      const at = [now, wallet.updatedAt, transaction.createdAt].sort().at(-1)!;
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
      session.insertTransaction(transaction);
      this.recordEvents(session, wallet, transaction, entry, context, at);
      return {
        transactionId: transaction.id,
        status: transaction.status,
        failureCode: transaction.failureCode,
        balance: wallet.balance.toJSON(),
        walletVersion: wallet.version,
      };
    });
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
