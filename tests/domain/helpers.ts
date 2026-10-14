import { expect } from 'bun:test';
import { DomainError } from '../../src/domain/errors.js';
import type { FailureCode } from '../../src/domain/errors.js';
import { Money } from '../../src/domain/money.js';
import { Wallet } from '../../src/domain/wallet.js';
import {
  WagerTransaction,
  WagerTransactionKind,
} from '../../src/domain/wager-transaction.js';
import type { CreateWagerTransactionProps } from '../../src/domain/wager-transaction.js';

export const at = '2026-10-14T12:00:00.000Z';
export const later = '2026-10-14T12:00:01.000Z';
export const money = (amount: string, currency = 'BRL') =>
  Money.from({ amount, currency });
export function transaction(
  overrides: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction {
  return WagerTransaction.create({
    id: 'tx',
    providerId: 'provider',
    externalTransactionId: 'external',
    idempotencyKey: 'provider:external',
    payloadHash: 'hash',
    walletId: 'wallet',
    playerId: 'player',
    roundId: 'round',
    gameId: 'game',
    kind: WagerTransactionKind.Bet,
    money: money('25.00'),
    createdAt: at,
    ...overrides,
  });
}
export function reference(
  overrides: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction {
  const tx = transaction({
    id: 'reference',
    externalTransactionId: 'reference-external',
    ...overrides,
  });
  tx.markProcessed(
    tx.referenceExternalTransactionId === undefined
      ? undefined
      : 'earlier-reference',
    at,
  );
  return tx;
}
export function open(amount = '100.00') {
  return Wallet.open({
    id: 'wallet',
    playerId: 'player',
    initialBalance: money(amount),
    at,
    ...(amount === '0.00'
      ? {}
      : {
          opening: {
            transactionId: 'opening',
            entryId: 'opening-entry',
            payloadHash: 'opening-hash',
          },
        }),
  });
}
export function expectCode(action: () => unknown, code: FailureCode): void {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}
