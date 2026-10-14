import { expect, test } from 'bun:test';
import { parseWagerMessage } from '../../src/adapters/messaging/request-contract.js';
import {
  visibilityBackoff,
  permanentMessageFailure,
} from '../../src/adapters/messaging/sqs-consumer.js';
import { runMessageWorker } from '../../src/adapters/workers/message-worker.js';
import { DomainError } from '../../src/domain/errors.js';
test('consumer backoff is capped and error classes separate permanent input from transient infrastructure', () => {
  expect([1, 2, 3, 4, 5, 100].map(visibilityBackoff)).toEqual([
    1, 2, 4, 8, 16, 60,
  ]);
  expect(permanentMessageFailure(DomainError.for('INVALID_INPUT'))).toBe(
    'INVALID_INPUT',
  );
  expect(permanentMessageFailure({ code: '23514' })).toBe(
    'INFRASTRUCTURE_PERMANENT',
  );
  expect(permanentMessageFailure({ code: '08006' })).toBeUndefined();
  expect(permanentMessageFailure(new Error('SQL password'))).toBeUndefined();
});
test('envelope validates timestamps, metadata and key, and canonical hash ignores object key order', () => {
  const body = {
    messageId: 'message',
    type: 'WagerTransactionRequested',
    occurredAt: '2026-10-14T00:00:00.000Z',
    data: {
      providerId: 'provider',
      externalTransactionId: 'external',
      idempotencyKey: 'key',
      playerId: 'player',
      walletId: 'wallet',
      roundId: 'round',
      gameId: 'game',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    },
  };
  const a = parseWagerMessage(JSON.stringify(body)),
    b = parseWagerMessage(
      JSON.stringify({
        ...body,
        data: Object.fromEntries(Object.entries(body.data).reverse()),
      }),
    );
  expect(a.delivery).toEqual(b.delivery);
  expect(a.context).toEqual({
    correlationId: 'message',
    causationId: 'message',
  });
  expect(() =>
    parseWagerMessage(JSON.stringify({ ...body, occurredAt: 'yesterday' })),
  ).toThrow();
  expect(() =>
    parseWagerMessage(JSON.stringify({ ...body, extra: true })),
  ).toThrow();
});
test('worker shutdown waits for the current operation and stops selecting work', async () => {
  const stop = new AbortController();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  let calls = 0,
    finished = false;
  const running = runMessageWorker(
    async () => {
      calls++;
      entered();
      await gate;
      return true;
    },
    stop.signal,
    () => {},
  ).then(() => {
    finished = true;
  });
  await started;
  stop.abort();
  await Promise.resolve();
  expect(finished).toBe(false);
  release();
  await running;
  expect(calls).toBe(1);
});
