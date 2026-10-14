import { ensure } from './errors.js';
import { LedgerDirection, WalletLedgerEntry } from './ledger.js';
import { Money } from './money.js';
import { atOrAfter, identifier, instant } from './values.js';
import { WagerTransaction, WagerTransactionKind } from './wager-transaction.js';

export interface WalletState {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly balance: Money;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface WalletOpening {
  readonly wallet: Wallet;
  readonly opening:
    | {
        readonly transaction: WagerTransaction;
        readonly entry: WalletLedgerEntry;
      }
    | undefined;
}
export interface MovementContext {
  readonly entryId: string;
  readonly at: string;
  readonly reference?: WagerTransaction;
  readonly alreadyReversed?: boolean;
}

export class Wallet {
  #state: WalletState;
  private constructor(state: WalletState) {
    this.#state = Object.freeze({ ...state });
  }
  static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
    at: string;
    opening?: { transactionId: string; entryId: string; payloadHash: string };
  }): WalletOpening {
    identifier(props.id);
    identifier(props.playerId);
    instant(props.at);
    ensure(!props.initialBalance.isNegative(), 'INVALID_MONEY');
    const wallet = new Wallet({
      id: props.id,
      playerId: props.playerId,
      currency: props.initialBalance.currency,
      balance: props.initialBalance,
      version: 1,
      createdAt: props.at,
      updatedAt: props.at,
    });
    if (props.initialBalance.isZero()) {
      ensure(props.opening === undefined);
      return { wallet, opening: undefined };
    }
    ensure(props.opening);
    const transaction = WagerTransaction.opening({
      id: props.opening.transactionId,
      walletId: props.id,
      playerId: props.playerId,
      money: props.initialBalance,
      payloadHash: props.opening.payloadHash,
      createdAt: props.at,
    });
    const entry = WalletLedgerEntry.create({
      id: props.opening.entryId,
      walletId: props.id,
      transactionId: transaction.id,
      direction: LedgerDirection.Credit,
      money: props.initialBalance,
      balanceBefore: Money.zero(wallet.currency),
      balanceAfter: props.initialBalance,
      createdAt: props.at,
    });
    transaction.markProcessed(undefined, props.at);
    return { wallet, opening: { transaction, entry } };
  }
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(state);
  }
  snapshot(): WalletState {
    return { ...this.#state };
  }
  get id() {
    return this.#state.id;
  }
  get playerId() {
    return this.#state.playerId;
  }
  get currency() {
    return this.#state.currency;
  }
  get balance() {
    return this.#state.balance;
  }
  get version() {
    return this.#state.version;
  }
  get createdAt() {
    return this.#state.createdAt;
  }
  get updatedAt() {
    return this.#state.updatedAt;
  }

  apply(
    transaction: WagerTransaction,
    context: MovementContext,
  ): WalletLedgerEntry | undefined {
    transaction.assertMutable();
    ensure(transaction.kind !== WagerTransactionKind.Opening);
    ensure(
      transaction.walletId === this.id &&
        transaction.playerId === this.playerId,
      'WALLET_MISMATCH',
    );
    ensure(transaction.money.currency === this.currency, 'CURRENCY_MISMATCH');
    atOrAfter(context.at, this.updatedAt);
    const direction = transaction.ledgerDirectionFor(
      context.reference,
      context.alreadyReversed,
    );
    if (direction === undefined) {
      transaction.markProcessed(undefined, context.at);
      return undefined;
    }
    const next =
      direction === LedgerDirection.Credit
        ? this.balance.add(transaction.money)
        : this.balance.subtract(transaction.money);
    ensure(
      !next.isNegative(),
      transaction.kind === WagerTransactionKind.Bet
        ? 'INSUFFICIENT_FUNDS'
        : 'REVERSAL_INSUFFICIENT_FUNDS',
    );
    ensure(Number.isSafeInteger(this.version + 1));
    const entry = WalletLedgerEntry.create({
      id: context.entryId,
      walletId: this.id,
      transactionId: transaction.id,
      direction,
      money: transaction.money,
      balanceBefore: this.balance,
      balanceAfter: next,
      createdAt: context.at,
    });
    transaction.markProcessed(context.reference?.id, context.at);
    this.#state = Object.freeze({
      ...this.#state,
      balance: next,
      version: this.version + 1,
      updatedAt: context.at,
    });
    return entry;
  }
}
