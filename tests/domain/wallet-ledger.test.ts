import { expect, test } from 'bun:test';
import { InvalidTransactionStateError } from '../../src/domain/errors.js';
import { LedgerDirection, WalletLedgerEntry } from '../../src/domain/ledger.js';
import { Money } from '../../src/domain/money.js';
import { Wallet } from '../../src/domain/wallet.js';
import {
  WagerTransactionKind as Kind,
  WagerTransactionStatus as Status,
} from '../../src/domain/wager-transaction.js';
import {
  at,
  later,
  expectCode,
  money,
  open,
  reference,
  transaction,
} from './helpers.js';

test('positive opening returns a matching internal transaction and immutable ledger, version 1', () => {
  const { wallet, opening } = open();
  expect(wallet.version).toBe(1);
  expect(wallet.balance.toString()).toBe('100.00');
  expect(opening?.transaction.kind).toBe(Kind.Opening);
  expect(opening?.transaction.status).toBe(Status.Processed);
  expect(opening?.entry.transactionId).toBe(opening?.transaction.id);
  expect(opening?.entry.balanceBefore.toString()).toBe('0.00');
  expect(opening?.entry.balanceAfter.equals(wallet.balance)).toBe(true);
  expect(opening?.entry.direction).toBe(LedgerDirection.Credit);
  expect(opening?.entry.isBalanced()).toBe(true);
});
test('zero opening has no transaction or ledger; negative opening is rejected', () => {
  const result = open('0.00');
  expect(result.opening).toBeUndefined();
  expect(result.wallet.version).toBe(1);
  expectCode(
    () =>
      Wallet.open({
        id: 'w',
        playerId: 'p',
        initialBalance: money('1.00').negate(),
        at,
      }),
    'INVALID_MONEY',
  );
  expectCode(
    () =>
      Wallet.open({
        id: 'w',
        playerId: 'p',
        initialBalance: money('1.00'),
        at,
      }),
    'INVALID_INPUT',
  );
});
test('BET debits and WIN credits with matching ledger and version changes', () => {
  const { wallet } = open();
  const bet = transaction();
  const debit = wallet.apply(bet, { entryId: 'debit', at: later });
  expect(debit?.direction).toBe(LedgerDirection.Debit);
  expect(wallet.balance.toString()).toBe('75.00');
  expect(wallet.version).toBe(2);
  expect(wallet.updatedAt).toBe(later);
  expect(bet.status).toBe(Status.Processed);
  const win = transaction({ id: 'win', kind: Kind.Win, money: money('75.00') });
  const credit = wallet.apply(win, { entryId: 'credit', at: later });
  expect(credit?.isBalanced()).toBe(true);
  expect(wallet.balance.toString()).toBe('150.00');
  expect(wallet.version).toBe(3);
});
test('LOSS processes without ledger, balance, version or balance timestamp changes', () => {
  const { wallet } = open();
  const before = wallet.snapshot();
  const loss = transaction({ kind: Kind.Loss, money: money('0.00') });
  expect(wallet.apply(loss, { entryId: 'unused', at: later })).toBeUndefined();
  expect(wallet.snapshot()).toEqual(before);
  expect(loss.status).toBe(Status.Processed);
  expect(loss.affectsBalance()).toBe(false);
});
test.each([Kind.Refund, Kind.Rollback])(
  '%s of BET credits the full amount',
  (kind) => {
    const { wallet } = open();
    const ref = reference();
    const tx = transaction({
      kind,
      referenceExternalTransactionId: ref.externalTransactionId,
    });
    const entry = wallet.apply(tx, {
      entryId: 'reverse',
      at: later,
      reference: ref,
      alreadyReversed: false,
    });
    expect(wallet.balance.toString()).toBe('125.00');
    expect(tx.referenceTransactionId).toBe(ref.id);
    expect(entry?.direction).toBe(LedgerDirection.Credit);
  },
);
test.each([Kind.Win, Kind.Refund])(
  'ROLLBACK of %s debits the wallet',
  (kind) => {
    const { wallet } = open();
    const ref = reference({
      kind,
      ...(kind === Kind.Refund
        ? { referenceExternalTransactionId: 'earlier' }
        : {}),
    });
    const tx = transaction({
      kind: Kind.Rollback,
      referenceExternalTransactionId: ref.externalTransactionId,
    });
    const entry = wallet.apply(tx, {
      entryId: 'reverse',
      at: later,
      reference: ref,
      alreadyReversed: false,
    });
    expect(wallet.balance.toString()).toBe('75.00');
    expect(entry?.direction).toBe(LedgerDirection.Debit);
  },
);
test('BET and credit reversal have distinct insufficient balance failures and leave state intact', () => {
  for (const reversal of [false, true]) {
    const { wallet } = open('10.00');
    const ref = reference({ kind: Kind.Win });
    const tx = transaction(
      reversal
        ? {
            kind: Kind.Rollback,
            referenceExternalTransactionId: ref.externalTransactionId,
          }
        : {},
    );
    const before = wallet.snapshot();
    const txBefore = tx.snapshot();
    expectCode(
      () =>
        wallet.apply(tx, {
          entryId: 'entry',
          at: later,
          ...(reversal ? { reference: ref, alreadyReversed: false } : {}),
        }),
      reversal ? 'REVERSAL_INSUFFICIENT_FUNDS' : 'INSUFFICIENT_FUNDS',
    );
    expect(wallet.snapshot()).toEqual(before);
    expect(tx.snapshot()).toEqual(txBefore);
    tx.reject(reversal ? 'REVERSAL_INSUFFICIENT_FUNDS' : 'INSUFFICIENT_FUNDS');
    expect(() => wallet.apply(tx, { entryId: 'entry', at: later })).toThrow(
      InvalidTransactionStateError,
    );
    expect(wallet.snapshot()).toEqual(before);
  }
});
test.each(['walletId', 'playerId'] as const)(
  'rejects %s mismatch before mutation',
  (field) => {
    const { wallet } = open();
    const before = wallet.snapshot();
    expectCode(
      () =>
        wallet.apply(transaction({ [field]: 'other' }), {
          entryId: 'e',
          at: later,
        }),
      'WALLET_MISMATCH',
    );
    expect(wallet.snapshot()).toEqual(before);
  },
);
test('rejects currency mismatch and malformed ledger identity before mutation', () => {
  const { wallet } = open();
  const before = wallet.snapshot();
  expectCode(
    () =>
      wallet.apply(transaction({ money: money('1.00', 'USD') }), {
        entryId: 'e',
        at: later,
      }),
    'CURRENCY_MISMATCH',
  );
  const tx = transaction();
  expectCode(
    () => wallet.apply(tx, { entryId: '', at: later }),
    'INVALID_INPUT',
  );
  expect(tx.status).toBe(Status.Pending);
  expect(wallet.snapshot()).toEqual(before);
});
test('processing timestamp failure and version overflow do not partially apply a movement', () => {
  const { wallet } = open();
  const before = wallet.snapshot();
  const future = transaction({ createdAt: later });
  expectCode(() => wallet.apply(future, { entryId: 'e', at }), 'INVALID_INPUT');
  expect(wallet.snapshot()).toEqual(before);
  expect(future.status).toBe(Status.Pending);
  const exhausted = Wallet.rehydrate({
    ...before,
    version: Number.MAX_SAFE_INTEGER,
  });
  const tx = transaction();
  expectCode(() => exhausted.apply(tx, { entryId: 'e', at }), 'INVALID_INPUT');
  expect(exhausted.version).toBe(Number.MAX_SAFE_INTEGER);
  expect(tx.status).toBe(Status.Pending);
});
test('a processed transaction cannot be applied again to the same in-memory aggregate', () => {
  const { wallet } = open();
  const tx = transaction();
  wallet.apply(tx, { entryId: 'e', at });
  const before = wallet.snapshot();
  expect(() => wallet.apply(tx, { entryId: 'again', at })).toThrow(
    InvalidTransactionStateError,
  );
  expect(wallet.snapshot()).toEqual(before);
});
test('sequential movements reconstruct the wallet from ledger without asserting concurrency', () => {
  const { wallet, opening } = open();
  const entries = [opening!.entry];
  const bet = transaction();
  entries.push(wallet.apply(bet, { entryId: 'bet', at })!);
  const win = transaction({
    id: 'win',
    externalTransactionId: 'win-ext',
    kind: Kind.Win,
    money: money('50.00'),
  });
  entries.push(wallet.apply(win, { entryId: 'win', at })!);
  const refund = transaction({
    id: 'refund',
    externalTransactionId: 'refund-ext',
    kind: Kind.Refund,
    referenceExternalTransactionId: bet.externalTransactionId,
  });
  entries.push(
    wallet.apply(refund, {
      entryId: 'refund',
      at,
      reference: bet,
      alreadyReversed: false,
    })!,
  );
  const rollback = transaction({
    id: 'rollback',
    kind: Kind.Rollback,
    referenceExternalTransactionId: win.externalTransactionId,
    money: money('50.00'),
  });
  entries.push(
    wallet.apply(rollback, {
      entryId: 'rollback',
      at,
      reference: win,
      alreadyReversed: false,
    })!,
  );
  const reconstructed = entries.reduce(
    (balance, entry) =>
      entry.direction === LedgerDirection.Credit
        ? balance.add(entry.money)
        : balance.subtract(entry.money),
    Money.zero('BRL'),
  );
  expect(reconstructed.equals(wallet.balance)).toBe(true);
  expect(wallet.balance.toString()).toBe('100.00');
  expect(wallet.version).toBe(entries.length);
  expect(entries.every((entry) => entry.isBalanced())).toBe(true);
});
test('ledger validates direction, arithmetic, currency and nonnegative balances', () => {
  const props = open().opening!.entry.snapshot();
  expectCode(
    () => WalletLedgerEntry.create({ ...props, balanceAfter: money('99.00') }),
    'INVALID_MONEY',
  );
  expectCode(
    () =>
      WalletLedgerEntry.create({
        ...props,
        direction: 'WRONG' as LedgerDirection,
      }),
    'INVALID_INPUT',
  );
  expectCode(
    () => WalletLedgerEntry.create({ ...props, money: money('0.00') }),
    'INVALID_MONEY',
  );
  expectCode(
    () =>
      WalletLedgerEntry.create({
        ...props,
        balanceAfter: money('1.00').negate(),
      }),
    'INVALID_MONEY',
  );
  expectCode(
    () => WalletLedgerEntry.create({ ...props, money: money('100.00', 'USD') }),
    'CURRENCY_MISMATCH',
  );
});
test('rehydration preserves versions and ledger facts without producing new opening effects', () => {
  const { wallet, opening } = open();
  const state = { ...wallet.snapshot(), version: 7 };
  const restored = Wallet.rehydrate(state);
  Object.assign(state, { version: 99, balance: money('0.00') });
  expect(restored.version).toBe(7);
  expect(restored.balance.toString()).toBe('100.00');
  const entryState = opening!.entry.snapshot();
  const entry = WalletLedgerEntry.rehydrate(entryState);
  Object.assign(entryState, { id: 'changed' });
  expect(entry.id).toBe('opening-entry');
  expect(Object.isFrozen(entry)).toBe(true);
  expect(() =>
    Object.assign(entry, { direction: LedgerDirection.Debit }),
  ).toThrow();
  const historical = WalletLedgerEntry.rehydrate({
    ...entryState,
    balanceAfter: money('99.00'),
  });
  expect(historical.isBalanced()).toBe(false);
});
