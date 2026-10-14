import { Money } from '../domain/money.js';
import type { MoneyProps } from '../domain/money.js';

export interface ReconciliationSnapshot {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  checkedEntries: number;
}
export function reconcileWallet(snapshot: ReconciliationSnapshot) {
  const difference = Money.rehydrate(snapshot.storedBalance).subtract(
    Money.rehydrate(snapshot.calculatedBalance),
  );
  return {
    ...snapshot,
    difference: difference.toJSON(),
    consistent: difference.isZero(),
  };
}
