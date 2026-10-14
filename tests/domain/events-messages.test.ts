import { expect, test } from 'bun:test';
import { InvalidMessageStateError } from '../../src/domain/errors.js';
import {
  WalletBalanceChanged,
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
} from '../../src/domain/events.js';
import { WalletLedgerEntry } from '../../src/domain/ledger.js';
import { InboxMessage, OutboxMessage } from '../../src/domain/messages.js';
import { immutableJson } from '../../src/domain/values.js';
import type { JsonValue } from '../../src/domain/values.js';
import { WagerTransactionKind as Kind } from '../../src/domain/wager-transaction.js';
import { at, later, expectCode, money, open, transaction } from './helpers.js';

const context = {
  eventId: 'event',
  correlationId: 'correlation',
  causationId: 'request',
  occurredAt: later,
};
function processedEvent() {
  const tx = transaction();
  tx.markProcessed(undefined, at);
  return WagerTransactionProcessed.from(tx, context);
}

test('processed event includes LOSS, typed envelope and decimal strings', () => {
  const { wallet } = open();
  const tx = transaction({ kind: Kind.Loss, money: money('0.00') });
  expect(wallet.apply(tx, { entryId: 'unused', at })).toBeUndefined();
  const event = WagerTransactionProcessed.from(tx, context);
  expect(event.toJSON()).toEqual({
    eventId: 'event',
    aggregateId: 'tx',
    correlationId: 'correlation',
    causationId: 'request',
    occurredAt: later,
    eventType: 'WagerTransactionProcessed',
    version: 1,
    data: {
      transactionId: 'tx',
      walletId: 'wallet',
      providerId: 'provider',
      externalTransactionId: 'external',
      kind: 'LOSS',
      money: { amount: '0.00', currency: 'BRL' },
      status: 'PROCESSED',
    },
  });
  expect(JSON.parse(JSON.stringify(event))).toEqual(event.toJSON());
});
test('rejected and pending events preserve failure and external reference', () => {
  const tx = transaction({
    kind: Kind.Refund,
    referenceExternalTransactionId: 'missing',
  });
  tx.markPendingReference();
  const pending = WagerTransactionPendingReference.from(tx, context);
  expect(pending.eventType).toBe('WagerTransactionPendingReference');
  expect(pending.data.referenceExternalTransactionId).toBe('missing');
  tx.reject('REFERENCE_NOT_FOUND');
  const rejected = WagerTransactionRejected.from(tx, context);
  expect(rejected.eventType).toBe('WagerTransactionRejected');
  expect(rejected.data.failureCode).toBe('REFERENCE_NOT_FOUND');
  expect(pending.data.status).toBe('PENDING_REFERENCE');
});
test('transaction events cannot be created from an incompatible state', () => {
  for (const from of [
    WagerTransactionProcessed.from,
    WagerTransactionRejected.from,
    WagerTransactionPendingReference.from,
  ]) {
    expectCode(() => from(transaction(), context), 'INVALID_INPUT');
  }
});
test('balance event follows a real movement and refuses zero or mismatched entries', () => {
  const { wallet, opening } = open();
  const event = WalletBalanceChanged.from(wallet, opening!.entry, context);
  expect(event.eventType).toBe('WalletBalanceChanged');
  expect(event.aggregateId).toBe(wallet.id);
  expect(event.data.walletVersion).toBe(1);
  expect(event.data.money).toEqual({ amount: '100.00', currency: 'BRL' });
  const zero = WalletLedgerEntry.rehydrate({
    ...opening!.entry.snapshot(),
    money: money('0.00'),
    balanceBefore: wallet.balance,
  });
  expectCode(
    () => WalletBalanceChanged.from(wallet, zero, context),
    'INVALID_INPUT',
  );
  const wrongWallet = WalletLedgerEntry.rehydrate({
    ...opening!.entry.snapshot(),
    walletId: 'other',
  });
  expectCode(
    () => WalletBalanceChanged.from(wallet, wrongWallet, context),
    'INVALID_INPUT',
  );
});
test('event identities and timestamps are validated; absent causation is omitted', () => {
  const tx = transaction();
  tx.markProcessed(undefined, later);
  expectCode(
    () => WagerTransactionProcessed.from(tx, { ...context, occurredAt: at }),
    'INVALID_INPUT',
  );
  expectCode(
    () => WagerTransactionProcessed.from(tx, { ...context, eventId: '' }),
    'INVALID_INPUT',
  );
  const event = WagerTransactionProcessed.from(tx, {
    eventId: 'e',
    correlationId: 'c',
    occurredAt: later,
  });
  expect(Object.hasOwn(event.toJSON(), 'causationId')).toBe(false);
});
test('event payload and object are deeply immutable', () => {
  const event = processedEvent();
  expect(Object.isFrozen(event)).toBe(true);
  expect(Object.isFrozen(event.data)).toBe(true);
  expect(Object.isFrozen(event.data.money)).toBe(true);
  expect(() => Object.assign(event.data.money, { amount: '99.00' })).toThrow();
  expect(() => Object.assign(event, { eventType: 'Other' })).toThrow();
  const envelope = event.toJSON();
  Object.assign(envelope, { eventId: 'changed' });
  expect(event.eventId).toBe('event');
});
test('JSON snapshot copies nested arrays and objects without aliases', () => {
  const source = {
    items: [{ amount: '1.00' }],
    valid: true,
    absent: null,
    version: 1,
  };
  const copy = immutableJson(source);
  source.items[0]!.amount = '2.00';
  source.items.push({ amount: '3.00' });
  expect(copy.items).toEqual([{ amount: '1.00' }]);
  expect(Object.isFrozen(copy.items)).toBe(true);
});
test.each([Infinity, NaN, 1n, new Date(at), undefined])(
  'rejects non-JSON payload %p',
  (value) => {
    expectCode(() => immutableJson(value as JsonValue), 'INVALID_INPUT');
  },
);
test('inbox records processing once and rejects conflicting payload', () => {
  const inbox = InboxMessage.receive({
    messageId: 'm',
    consumerName: 'consumer',
    payloadHash: 'hash',
    receivedAt: at,
  });
  expect(inbox.isProcessed()).toBe(false);
  inbox.assertPayload('hash');
  expectCode(() => inbox.assertPayload('other'), 'IDEMPOTENCY_CONFLICT');
  inbox.markProcessed(later);
  expect(inbox.isProcessed()).toBe(true);
  expect(inbox.processedAt).toBe(later);
  expect(() => inbox.markProcessed(later)).toThrow(InvalidMessageStateError);
  const restored = InboxMessage.rehydrate(inbox.snapshot());
  expect(restored.snapshot()).toEqual(inbox.snapshot());
  expect(() => restored.markProcessed(later)).toThrow(InvalidMessageStateError);
});
test('inbox rejects invalid receipt and backwards timestamps without mutating', () => {
  expectCode(
    () =>
      InboxMessage.receive({
        messageId: '',
        consumerName: 'c',
        payloadHash: 'h',
        receivedAt: at,
      }),
    'INVALID_INPUT',
  );
  const inbox = InboxMessage.receive({
    messageId: 'm',
    consumerName: 'c',
    payloadHash: 'h',
    receivedAt: later,
  });
  expectCode(() => inbox.markProcessed(at), 'INVALID_INPUT');
  expect(inbox.isProcessed()).toBe(false);
});
test('outbox stores the complete immutable envelope and copies rehydrated payload', () => {
  const event = processedEvent();
  const outbox = OutboxMessage.enqueue(event);
  expect(outbox.payload).toEqual(event.toJSON());
  expect(outbox.id).toBe(event.eventId);
  expect(outbox.attempts).toBe(0);
  expect(outbox.aggregateId).toBe('tx');
  expect(outbox.eventType).toBe('WagerTransactionProcessed');
  const payload = { nested: { amount: '1.00' } };
  const restored = OutboxMessage.rehydrate({ ...outbox.snapshot(), payload });
  payload.nested.amount = '2.00';
  expect(restored.payload).toEqual({ nested: { amount: '1.00' } });
  expect(Object.isFrozen(restored.payload)).toBe(true);
});
test('outbox uses caller policy with exponential backoff and cap, restored between attempts', () => {
  let outbox = OutboxMessage.enqueue(processedEvent());
  expect(outbox.isDue(at)).toBe(false);
  expect(outbox.isDue(later)).toBe(true);
  let now = later;
  for (const [index, delay] of [100, 200, 400, 500, 500].entries()) {
    outbox.scheduleRetry(now, { baseDelayMs: 100, maxDelayMs: 500 });
    expect(outbox.attempts).toBe(index + 1);
    expect(Date.parse(outbox.nextAttemptAt!) - Date.parse(now)).toBe(delay);
    expect(outbox.isDue(now)).toBe(false);
    now = outbox.nextAttemptAt!;
    expect(outbox.isDue(now)).toBe(true);
    outbox = OutboxMessage.rehydrate(outbox.snapshot());
  }
  outbox.markPublished(now);
  expect(outbox.isPending()).toBe(false);
  expect(outbox.isDue(now)).toBe(false);
  expect(outbox.nextAttemptAt).toBeUndefined();
  expect(outbox.publishedAt).toBe(now);
  expect(() => outbox.markPublished(now)).toThrow(InvalidMessageStateError);
  expect(() =>
    outbox.scheduleRetry(now, { baseDelayMs: 100, maxDelayMs: 500 }),
  ).toThrow(InvalidMessageStateError);
  expect(OutboxMessage.rehydrate(outbox.snapshot()).isPending()).toBe(false);
});
test.each([
  { baseDelayMs: 0, maxDelayMs: 1 },
  { baseDelayMs: 2, maxDelayMs: 1 },
  { baseDelayMs: 0.5, maxDelayMs: 1 },
  { baseDelayMs: 1, maxDelayMs: Infinity },
])('invalid backoff leaves outbox state untouched: %j', (policy) => {
  const outbox = OutboxMessage.enqueue(processedEvent());
  const before = outbox.snapshot();
  expectCode(() => outbox.scheduleRetry(later, policy), 'INVALID_INPUT');
  expect(outbox.snapshot()).toEqual(before);
});
test('retry limits remain exact at large counts and timestamp overflow fails before mutation', () => {
  const pending = OutboxMessage.enqueue(processedEvent());
  const huge = OutboxMessage.rehydrate({
    ...pending.snapshot(),
    attempts: 2000,
  });
  huge.scheduleRetry(later, { baseDelayMs: 1, maxDelayMs: 500 });
  expect(Date.parse(huge.nextAttemptAt!) - Date.parse(later)).toBe(500);
  const exhausted = OutboxMessage.rehydrate({
    ...pending.snapshot(),
    attempts: Number.MAX_SAFE_INTEGER,
  });
  expectCode(
    () => exhausted.scheduleRetry(later, { baseDelayMs: 1, maxDelayMs: 500 }),
    'INVALID_INPUT',
  );
  expectCode(
    () =>
      pending.scheduleRetry(later, {
        baseDelayMs: Number.MAX_SAFE_INTEGER,
        maxDelayMs: Number.MAX_SAFE_INTEGER,
      }),
    'INVALID_INPUT',
  );
  expect(pending.attempts).toBe(0);
});
test.each([
  'not-a-date',
  '2026-02-30T12:00:00.000Z',
  '2026-10-14',
  '2026-10-14T12:00:00-03:00',
])('factories reject noncanonical timestamp %s', (createdAt) => {
  expectCode(() => transaction({ createdAt }), 'INVALID_INPUT');
});
