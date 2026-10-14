import { expect, test } from 'bun:test';
import {
  newReferenceJob,
  nextReferenceAttempt,
} from '../../src/application/reference-schedule.js';
import { runReferenceWorker } from '../../src/adapters/workers/reference-worker.js';
const at = '2026-10-14T00:00:00.000Z';
const expiry = '2026-10-15T00:00:00.000Z';
test('reference policy doubles delays, caps at one minute and never passes expiry', () => {
  const job = newReferenceJob('tx', at, { correlationId: 'correlation' });
  expect(job.expiresAt).toBe(expiry);
  expect(job.nextAttemptAt).toBe('2026-10-14T00:00:01.000Z');
  expect(
    [0, 1, 2, 5, 6, 10000].map(
      (n) => Date.parse(nextReferenceAttempt(at, n, expiry)) - Date.parse(at),
    ),
  ).toEqual([1000, 2000, 4000, 32000, 60000, 60000]);
  expect(nextReferenceAttempt('2026-10-14T23:59:59.500Z', 10, expiry)).toBe(
    expiry,
  );
  expect(() => nextReferenceAttempt(at, -1, expiry)).toThrow();
});
test('shutdown waits for in-flight work and schedules no next attempt', async () => {
  const stop = new AbortController();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  let calls = 0;
  let ended = false;
  const running = runReferenceWorker(
    async () => {
      calls++;
      entered();
      await gate;
      return { status: 'PROCESSED' };
    },
    stop.signal,
    () => {},
  ).then(() => {
    ended = true;
  });
  await started;
  stop.abort();
  await Promise.resolve();
  expect(ended).toBe(false);
  release();
  await running;
  expect(calls).toBe(1);
});
test('one-shot failures exit with an error and logs do not expose the underlying exception', async () => {
  const logs: Record<string, unknown>[] = [];
  await expect(
    runReferenceWorker(
      async () => {
        throw new Error('private SQL password');
      },
      new AbortController().signal,
      (e) => logs.push(e),
      true,
    ),
  ).rejects.toThrow();
  expect(logs).toEqual([{ level: 'error', event: 'reference_attempt_failed' }]);
});
