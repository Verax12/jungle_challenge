import { expect, test } from 'bun:test';
import { InvalidTransactionStateError } from '../../src/domain/errors.js';
import { LedgerDirection } from '../../src/domain/ledger.js';
import {
  WagerTransaction,
  WagerTransactionKind as Kind,
  WagerTransactionStatus as Status,
} from '../../src/domain/wager-transaction.js';
import type { CreateWagerTransactionProps } from '../../src/domain/wager-transaction.js';
import {
  at,
  later,
  expectCode,
  money,
  reference,
  transaction,
} from './helpers.js';

test.each([Kind.Refund, Kind.Rollback])('%s requires a reference', (kind) => {
  expectCode(() => transaction({ kind }), 'REFERENCE_REQUIRED');
  expectCode(
    () => transaction({ kind, referenceExternalTransactionId: '' }),
    'INVALID_INPUT',
  );
});
test.each([Kind.Bet, Kind.Loss])(
  '%s rejects an unexpected reference',
  (kind) => {
    expectCode(
      () =>
        transaction({
          kind,
          money: money(kind === Kind.Loss ? '0.00' : '1.00'),
          referenceExternalTransactionId: 'ref',
        }),
      'REFERENCE_NOT_ALLOWED',
    );
  },
);
test.each([Kind.Bet, Kind.Win, Kind.Refund, Kind.Rollback])(
  '%s rejects zero monetary effect',
  (kind) => {
    expectCode(
      () =>
        transaction({
          kind,
          money: money('0.00'),
          referenceExternalTransactionId: 'ref',
        }),
      'INVALID_MONEY',
    );
  },
);
test('LOSS requires zero and OPENING is unavailable to the external factory', () => {
  expectCode(() => transaction({ kind: Kind.Loss }), 'INVALID_MONEY');
  expectCode(
    () =>
      transaction({
        kind: Kind.Opening as CreateWagerTransactionProps['kind'],
      }),
    'INVALID_INPUT',
  );
});
test.each([
  'id',
  'providerId',
  'playerId',
  'walletId',
  'roundId',
  'gameId',
  'externalTransactionId',
  'idempotencyKey',
  'payloadHash',
] as const)('rejects blank %s', (field) => {
  expectCode(() => transaction({ [field]: ' ' }), 'INVALID_INPUT');
});
test('self-reference is rejected and an optional WIN reference must be resolved', () => {
  expectCode(
    () =>
      transaction({
        kind: Kind.Win,
        referenceExternalTransactionId: 'external',
      }),
    'REFERENCE_SCOPE_MISMATCH',
  );
  const win = transaction({
    kind: Kind.Win,
    referenceExternalTransactionId: 'reference-external',
  });
  expectCode(() => win.ledgerDirectionFor(), 'REFERENCE_NOT_FOUND');
  expect(win.ledgerDirectionFor(reference())).toBe(LedgerDirection.Credit);
});
test.each([Kind.Refund, Kind.Rollback])(
  '%s uses a full processed reference and explicit reversal history',
  (kind) => {
    const tx = transaction({
      kind,
      referenceExternalTransactionId: 'reference-external',
    });
    expectCode(() => tx.ledgerDirectionFor(), 'REFERENCE_NOT_FOUND');
    expectCode(() => tx.ledgerDirectionFor(reference()), 'INVALID_INPUT');
    expectCode(
      () => tx.ledgerDirectionFor(reference(), true),
      'REFERENCE_ALREADY_REVERSED',
    );
    expectCode(
      () => tx.ledgerDirectionFor(reference({ money: money('26.00') }), false),
      'REFERENCE_AMOUNT_MISMATCH',
    );
    expect(tx.ledgerDirectionFor(reference(), false)).toBe(
      LedgerDirection.Credit,
    );
  },
);
test.each([
  'providerId',
  'playerId',
  'walletId',
  'roundId',
  'externalTransactionId',
] as const)('reference scope mismatch: %s', (field) => {
  const tx = transaction({
    kind: Kind.Refund,
    referenceExternalTransactionId: 'reference-external',
  });
  expectCode(
    () => tx.ledgerDirectionFor(reference({ [field]: 'other' }), false),
    'REFERENCE_SCOPE_MISMATCH',
  );
});
test('reference currency must match but gameId is not an additional README constraint', () => {
  const tx = transaction({
    kind: Kind.Refund,
    referenceExternalTransactionId: 'reference-external',
  });
  expectCode(
    () =>
      tx.ledgerDirectionFor(reference({ money: money('25.00', 'USD') }), false),
    'CURRENCY_MISMATCH',
  );
  expect(
    tx.ledgerDirectionFor(reference({ gameId: 'other-game' }), false),
  ).toBe(LedgerDirection.Credit);
});
test.each([
  Status.Pending,
  Status.PendingReference,
  Status.Rejected,
  Status.Failed,
])('reference status %s cannot be reversed', (status) => {
  const ref = WagerTransaction.rehydrate({ ...reference().snapshot(), status });
  const tx = transaction({
    kind: Kind.Refund,
    referenceExternalTransactionId: ref.externalTransactionId,
  });
  expectCode(
    () => tx.ledgerDirectionFor(ref, false),
    'REFERENCE_NOT_PROCESSED',
  );
});
test.each([Kind.Win, Kind.Refund, Kind.Rollback, Kind.Loss, Kind.Opening])(
  'REFUND rejects reference kind %s',
  (kind) => {
    const ref = WagerTransaction.rehydrate({ ...reference().snapshot(), kind });
    expectCode(
      () =>
        transaction({
          kind: Kind.Refund,
          referenceExternalTransactionId: ref.externalTransactionId,
        }).ledgerDirectionFor(ref, false),
      'REFERENCE_KIND_MISMATCH',
    );
  },
);
test.each([Kind.Rollback, Kind.Loss, Kind.Opening])(
  'ROLLBACK rejects reference kind %s',
  (kind) => {
    const ref = WagerTransaction.rehydrate({ ...reference().snapshot(), kind });
    expectCode(
      () =>
        transaction({
          kind: Kind.Rollback,
          referenceExternalTransactionId: ref.externalTransactionId,
        }).ledgerDirectionFor(ref, false),
      'REFERENCE_KIND_MISMATCH',
    );
  },
);
test.each([Kind.Win, Kind.Refund])('ROLLBACK inverts a %s credit', (kind) => {
  const ref = reference({
    kind,
    ...(kind === Kind.Refund
      ? { referenceExternalTransactionId: 'earlier' }
      : {}),
  });
  expect(
    transaction({
      kind: Kind.Rollback,
      referenceExternalTransactionId: ref.externalTransactionId,
    }).ledgerDirectionFor(ref, false),
  ).toBe(LedgerDirection.Debit);
});
test('WIN references only BET, can have a different payout and can omit reference', () => {
  expect(transaction({ kind: Kind.Win }).ledgerDirectionFor()).toBe(
    LedgerDirection.Credit,
  );
  const win = transaction({
    kind: Kind.Win,
    referenceExternalTransactionId: 'reference-external',
    money: money('50.00'),
  });
  expect(win.ledgerDirectionFor(reference())).toBe(LedgerDirection.Credit);
  expectCode(
    () => win.ledgerDirectionFor(reference({ kind: Kind.Win })),
    'REFERENCE_KIND_MISMATCH',
  );
});
test('states progress explicitly and preserve an internal resolved reference', () => {
  const tx = transaction({
    kind: Kind.Refund,
    referenceExternalTransactionId: 'reference-external',
  });
  expect(tx.status).toBe(Status.Pending);
  tx.markPendingReference();
  tx.markPendingReference();
  expect(tx.status).toBe(Status.PendingReference);
  expectCode(() => tx.markProcessed(undefined, later), 'REFERENCE_REQUIRED');
  tx.markProcessed('reference', later);
  expect(tx.referenceTransactionId).toBe('reference');
  expect(tx.processedAt).toBe(later);
  expect(tx.isTerminal()).toBe(true);
});
test.each([Status.Pending, Status.PendingReference])(
  '%s can reach every terminal state',
  (status) => {
    for (const terminal of [Status.Processed, Status.Rejected, Status.Failed]) {
      const tx = transaction({
        kind: Kind.Refund,
        referenceExternalTransactionId: 'reference-external',
      });
      if (status === Status.PendingReference) tx.markPendingReference();
      if (terminal === Status.Processed) tx.markProcessed('reference', later);
      else if (terminal === Status.Rejected) tx.reject('REFERENCE_NOT_FOUND');
      else tx.fail('INFRASTRUCTURE_PERMANENT');
      expect(tx.status).toBe(terminal);
    }
  },
);
test.each([Status.Processed, Status.Rejected, Status.Failed])(
  '%s blocks all further transitions',
  (status) => {
    const tx = WagerTransaction.rehydrate({
      ...transaction().snapshot(),
      status,
    });
    const before = tx.snapshot();
    for (const action of [
      () => tx.markProcessed(undefined, later),
      () => tx.markPendingReference(),
      () => tx.reject('INVALID_INPUT'),
      () => tx.fail('INFRASTRUCTURE_PERMANENT'),
    ])
      expect(action).toThrow(InvalidTransactionStateError);
    expect(tx.snapshot()).toEqual(before);
  },
);
test('payload divergence is conflict rather than replay', () => {
  const tx = transaction();
  expect(tx.matchesPayload('hash')).toBe(true);
  tx.assertPayload('hash');
  expectCode(() => tx.assertPayload('changed'), 'IDEMPOTENCY_CONFLICT');
  expect(tx.status).toBe(Status.Pending);
});

test('transition validation rejects impossible reference links and invalid failure categories', () => {
  const tx = transaction();
  const before = tx.snapshot();
  expectCode(() => tx.markPendingReference(), 'REFERENCE_NOT_ALLOWED');
  expectCode(
    () => tx.markProcessed('unexpected', later),
    'REFERENCE_NOT_ALLOWED',
  );
  expectCode(
    () => tx.reject('INFRASTRUCTURE_PERMANENT' as 'INVALID_INPUT'),
    'INVALID_INPUT',
  );
  expectCode(() => tx.reject('UNKNOWN' as 'INVALID_INPUT'), 'INVALID_INPUT');
  expectCode(
    () => tx.fail('INVALID_INPUT' as 'INFRASTRUCTURE_PERMANENT'),
    'INVALID_INPUT',
  );
  expect(tx.snapshot()).toEqual(before);
});
test('rehydration preserves terminal data without rerunning create or transition validation', () => {
  const state = {
    ...transaction().snapshot(),
    status: Status.Rejected,
    failureCode: 'INSUFFICIENT_FUNDS' as const,
  };
  const tx = WagerTransaction.rehydrate(state);
  Object.assign(state, { status: Status.Pending });
  expect(tx.status).toBe(Status.Rejected);
  expect(tx.failureCode).toBe('INSUFFICIENT_FUNDS');
  expect(tx.createdAt).toBe(at);
  expect(tx.snapshot()).not.toBe(state);
});
