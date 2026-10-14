import { ensure } from './errors.js';
import type { Money } from './money.js';
import { identifier, instant } from './values.js';

export enum LedgerDirection {
  Debit = 'DEBIT',
  Credit = 'CREDIT',
}
export interface LedgerEntryState {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly createdAt: string;
}

export class WalletLedgerEntry {
  private constructor(private readonly state: LedgerEntryState) {
    Object.freeze(this);
  }
  static create(props: LedgerEntryState): WalletLedgerEntry {
    [props.id, props.walletId, props.transactionId].forEach(identifier);
    instant(props.createdAt);
    ensure(Object.values(LedgerDirection).includes(props.direction));
    ensure(props.money.isPositive(), 'INVALID_MONEY');
    ensure(
      !props.balanceBefore.isNegative() && !props.balanceAfter.isNegative(),
      'INVALID_MONEY',
    );
    const entry = WalletLedgerEntry.rehydrate(props);
    ensure(entry.isBalanced(), 'INVALID_MONEY');
    return entry;
  }
  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(Object.freeze({ ...state }));
  }
  get id() {
    return this.state.id;
  }
  get walletId() {
    return this.state.walletId;
  }
  get transactionId() {
    return this.state.transactionId;
  }
  get direction() {
    return this.state.direction;
  }
  get money() {
    return this.state.money;
  }
  get balanceBefore() {
    return this.state.balanceBefore;
  }
  get balanceAfter() {
    return this.state.balanceAfter;
  }
  get createdAt() {
    return this.state.createdAt;
  }
  snapshot(): LedgerEntryState {
    return { ...this.state };
  }
  isBalanced(): boolean {
    const expected =
      this.direction === LedgerDirection.Credit
        ? this.balanceBefore.add(this.money)
        : this.balanceBefore.subtract(this.money);
    return expected.equals(this.balanceAfter);
  }
}
