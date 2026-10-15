import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { createApplication } from '../../src/composition/bootstrap.js';

let app: Awaited<ReturnType<typeof createApplication>>;
let url: string;
let calls = 0;
const fail = async () => {
  calls++;
  throw new Error('Financial service must not run for parser errors');
};
beforeAll(async () => {
  app = await createApplication(true, {
    processing: { createWallet: fail, process: fail },
    queries: {
      reconciliation: fail,
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
beforeEach(() => {
  calls = 0;
});

test.each([
  {
    label: 'oversized JSON',
    contentType: 'application/json',
    body: JSON.stringify({ value: 'x'.repeat(110_000) }),
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
  },
  {
    label: 'unsupported charset',
    contentType: 'application/json; charset=koi8-r',
    body: '{}',
    status: 415,
    code: 'INVALID_REQUEST',
  },
  {
    label: 'unsupported content encoding',
    contentType: 'application/json',
    contentEncoding: 'unsupported-encoding',
    body: '{}',
    status: 415,
    code: 'INVALID_REQUEST',
  },
  {
    label: 'malformed JSON',
    contentType: 'application/json',
    body: '{"secret":"financial-payload",invalid}',
    status: 400,
    code: 'INVALID_REQUEST',
  },
])(
  'HTTP classifies $label as client input instead of an internal failure',
  async ({ contentType, contentEncoding, body, status, code }) => {
    const response = await fetch(`${url}/wallets`, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        ...(contentEncoding ? { 'Content-Encoding': contentEncoding } : {}),
      },
      body,
    });
    const result: unknown = await response.json();
    expect(calls).toBe(0);
    expect(response.status).toBe(status);
    expect(result).toEqual({ code });
    expect(response.headers.get('retry-after')).toBeNull();
  },
);
