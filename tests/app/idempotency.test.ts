import { expect, test } from 'bun:test';
import {
  IdempotencyConflictError,
  replay,
} from '../../src/application/idempotency.js';
import type { ProcessingReceipt } from '../../src/application/idempotency.js';
import { WagerTransactionStatus } from '../../src/domain/wager-transaction.js';

const receipt: ProcessingReceipt = {
  idempotencyKey: 'key',
  providerId: 'provider',
  externalTransactionId: 'external',
  payloadHash: 'original-hash',
  result: {
    transactionId: 'transaction',
    status: WagerTransactionStatus.Processed,
    balance: { amount: '75.00', currency: 'BRL' },
    walletVersion: 2,
  },
};
test('idempotency replay preserves stored response and rejects the same key with a different payload hash', () => {
  expect(replay([receipt], receipt, 'original-hash')).toEqual(receipt.result);
  expect(() => replay([receipt], receipt, 'different-hash')).toThrow(
    IdempotencyConflictError,
  );
});
