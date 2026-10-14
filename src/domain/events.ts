import { ensure } from './errors.js';
import type { LedgerDirection, WalletLedgerEntry } from './ledger.js';
import { atOrAfter, identifier, immutableJson, instant } from './values.js';
import type { JsonValue } from './values.js';
import type { Wallet } from './wallet.js';
import { WagerTransactionStatus } from './wager-transaction.js';
import type { WagerTransaction } from './wager-transaction.js';

export interface EventContext {
  readonly eventId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: string;
}
export interface IntegrationEventProps<
  T extends JsonValue,
> extends EventContext {
  readonly aggregateId: string;
  readonly data: T;
}

export abstract class IntegrationEvent<T extends JsonValue> {
  abstract readonly eventType: string;
  abstract readonly version: number;
  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId: string | undefined;
  readonly occurredAt: string;
  readonly data: T;

  protected constructor(props: IntegrationEventProps<T>) {
    [props.eventId, props.aggregateId, props.correlationId].forEach(identifier);
    if (props.causationId !== undefined) identifier(props.causationId);
    instant(props.occurredAt);
    this.eventId = props.eventId;
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this.occurredAt = props.occurredAt;
    this.data = immutableJson(props.data);
  }
  toJSON() {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      ...(this.causationId === undefined
        ? {}
        : { causationId: this.causationId }),
      occurredAt: this.occurredAt,
      version: this.version,
      data: this.data,
    };
  }
}

type MoneyData = { readonly amount: string; readonly currency: string };
type TransactionData = Readonly<{
  transactionId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  kind: string;
  money: MoneyData;
  status: string;
}>;
function transactionData(
  transaction: WagerTransaction,
  status: WagerTransactionStatus,
  ctx: EventContext,
): TransactionData {
  ensure(transaction.status === status);
  atOrAfter(ctx.occurredAt, transaction.processedAt ?? transaction.createdAt);
  return {
    transactionId: transaction.id,
    walletId: transaction.walletId,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    kind: transaction.kind,
    money: transaction.money.toJSON(),
    status: transaction.status,
  };
}

export class WagerTransactionProcessed extends IntegrationEvent<TransactionData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;
  private constructor(props: IntegrationEventProps<TransactionData>) {
    super(props);
    Object.freeze(this);
  }
  static from(
    transaction: WagerTransaction,
    ctx: EventContext,
  ): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
      ...ctx,
      aggregateId: transaction.id,
      data: transactionData(transaction, WagerTransactionStatus.Processed, ctx),
    });
  }
}
type RejectedData = TransactionData & { readonly failureCode: string };
export class WagerTransactionRejected extends IntegrationEvent<RejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;
  private constructor(props: IntegrationEventProps<RejectedData>) {
    super(props);
    Object.freeze(this);
  }
  static from(
    transaction: WagerTransaction,
    ctx: EventContext,
  ): WagerTransactionRejected {
    const data = transactionData(
      transaction,
      WagerTransactionStatus.Rejected,
      ctx,
    );
    ensure(transaction.failureCode !== undefined);
    return new WagerTransactionRejected({
      ...ctx,
      aggregateId: transaction.id,
      data: { ...data, failureCode: transaction.failureCode },
    });
  }
}
type PendingData = TransactionData & {
  readonly referenceExternalTransactionId: string;
};
export class WagerTransactionPendingReference extends IntegrationEvent<PendingData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;
  private constructor(props: IntegrationEventProps<PendingData>) {
    super(props);
    Object.freeze(this);
  }
  static from(
    transaction: WagerTransaction,
    ctx: EventContext,
  ): WagerTransactionPendingReference {
    const data = transactionData(
      transaction,
      WagerTransactionStatus.PendingReference,
      ctx,
    );
    ensure(transaction.referenceExternalTransactionId !== undefined);
    return new WagerTransactionPendingReference({
      ...ctx,
      aggregateId: transaction.id,
      data: {
        ...data,
        referenceExternalTransactionId:
          transaction.referenceExternalTransactionId,
      },
    });
  }
}
type BalanceData = Readonly<{
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyData;
  balanceBefore: MoneyData;
  balanceAfter: MoneyData;
  walletVersion: number;
}>;
export class WalletBalanceChanged extends IntegrationEvent<BalanceData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;
  private constructor(props: IntegrationEventProps<BalanceData>) {
    super(props);
    Object.freeze(this);
  }
  static from(
    wallet: Wallet,
    entry: WalletLedgerEntry,
    ctx: EventContext,
  ): WalletBalanceChanged {
    ensure(
      wallet.id === entry.walletId && wallet.balance.equals(entry.balanceAfter),
    );
    ensure(
      entry.money.isPositive() &&
        entry.isBalanced() &&
        !entry.balanceBefore.equals(entry.balanceAfter),
    );
    atOrAfter(ctx.occurredAt, entry.createdAt);
    return new WalletBalanceChanged({
      ...ctx,
      aggregateId: wallet.id,
      data: {
        walletId: wallet.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
    });
  }
}
