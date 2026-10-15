import { afterAll, beforeAll, expect, test } from 'bun:test';
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

test.each([
  {
    label: 'oversized JSON',
    contentType: 'application/json',
    body: JSON.stringify({ value: 'x'.repeat(110_000) }),
    status: 413,
  },
  {
    label: 'unsupported charset',
    contentType: 'application/json; charset=koi8-r',
    body: '{}',
    status: 415,
  },
])(
  'HTTP classifies $label as client input instead of an internal failure',
  async ({ label, contentType, body, status }) => {
    const response = await fetch(`${url}/wallets`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });
    const result: unknown = await response.json();
    console.log(
      JSON.stringify({
        scenario: label,
        actualStatus: response.status,
        expectedStatus: status,
        result,
      }),
    );
    expect(calls).toBe(0);
    expect(response.status).toBe(status);
  },
);
