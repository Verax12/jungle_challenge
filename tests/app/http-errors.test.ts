import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createApplication } from '../../src/composition/bootstrap.js';
import { canonicalJson } from '../../src/application/idempotency.js';
import { errorResponse } from '../../src/adapters/http/financial-error.filter.js';

let current: Error;
let app: Awaited<ReturnType<typeof createApplication>>;
let url: string;
const fail = async () => {
  throw current;
};
beforeAll(async () => {
  app = await createApplication(true, {
    processing: { createWallet: fail, process: fail },
    queries: {
      wallet: fail,
      transaction: fail,
      externalTransaction: fail,
      ledger: fail,
    },
  });
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
});

test.each([
  '40001',
  '40P01',
  '55P03',
  '57014',
  '08006',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
])('transient %s maps to 503 without exposing driver details', async (code) => {
  current = Object.assign(new Error('SQL secret-password full-payload'), {
    code,
  });
  const result = await fetch(`${url}/wallets/example`);
  expect(result.status).toBe(503);
  expect(result.headers.get('retry-after')).toBe('1');
  expect(await result.json()).toEqual({ code: 'INFRASTRUCTURE_TRANSIENT' });
});
test('unexpected failures return a distinct generic 500 while liveness remains public', async () => {
  current = new Error('SQL secret-password full-payload');
  const response = await fetch(`${url}/wallets/example`);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ code: 'INTERNAL_ERROR' });
  expect((await fetch(`${url}/health/live`)).status).toBe(200);
});
test('pool exhaustion and wrapped connection errors are transient; SQL bugs are not', () => {
  expect(
    errorResponse(
      Object.assign(new Error('pool'), { name: 'KnexTimeoutError' }),
    ).status,
  ).toBe(503);
  expect(errorResponse({ cause: { code: 'ECONNRESET' } }).status).toBe(503);
  expect(errorResponse({ code: '42P01' }).status).toBe(500);
});
test('canonical JSON sorts objects recursively and preserves arrays and exact string values', () => {
  expect(canonicalJson({ z: [{ b: '0.10', a: 'USD' }], a: 'text"' })).toBe(
    JSON.stringify({ a: 'text"', z: [{ a: 'USD', b: '0.10' }] }),
  );
  expect(canonicalJson({ a: '0.10' })).not.toBe(canonicalJson({ a: '0.11' }));
});
