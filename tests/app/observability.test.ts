import { expect, test } from 'bun:test';
import { reconcileWallet } from '../../src/application/reconcile-wallet.js';
import { Telemetry } from '../../src/adapters/observability/telemetry.js';

test('reconciliation preserves exact large decimals and signed differences', () => {
  for (const [stored, calculated, difference] of [
    [
      '999999999999999999999999999999999999.99',
      '999999999999999999999999999999999999.98',
      '0.01',
    ],
    ['0.00', '0.01', '-0.01'],
    ['1.00', '-2.00', '3.00'],
    ['0.00', '0.00', '0.00'],
  ]) {
    const r = reconcileWallet({
      walletId: 'wallet',
      storedBalance: { amount: stored!, currency: 'BRL' },
      calculatedBalance: { amount: calculated!, currency: 'BRL' },
      checkedEntries: 3,
    });
    expect(r.difference.amount).toBe(difference!);
    expect(r.consistent).toBe(difference === '0.00');
  }
});
test('structured logs whitelist fields, serialize controls and tolerate a failed log sink', () => {
  const lines: string[] = [];
  const t = new Telemetry((line) => lines.push(line));
  t.report({
    event: 'transaction_committed',
    correlationId: 'a\nb',
    walletId: 'wallet',
    body: { password: 'secret' },
    money: '123.45',
    sql: 'secret',
    error: new Error('secret'),
  });
  expect(lines).toHaveLength(1);
  const parsed = JSON.parse(lines[0]!);
  expect(parsed).toMatchObject({
    correlationId: 'a\nb',
    messageId: null,
    transactionId: null,
    walletId: 'wallet',
    providerId: null,
  });
  expect(lines[0]).not.toContain('secret');
  expect(lines[0]).not.toContain('123.45');
  expect(() =>
    new Telemetry(() => {
      throw new Error('sink failed');
    }).report({ event: 'test' }),
  ).not.toThrow();
});
test('metrics use bounded labels and failure observations exclude exception content', async () => {
  const lines: string[] = [];
  const t = new Telemetry((line) => lines.push(line));
  await expect(
    t.observe('http', { walletId: 'private-wallet' }, async () => {
      throw { cause: { code: '40P01' }, message: 'secret SQL' };
    }),
  ).rejects.toBeDefined();
  const metrics = await t.registry.metrics();
  expect(metrics).toContain(
    'wagering_lock_conflicts_total{source="http",code="40P01"} 1',
  );
  expect(metrics).toContain(
    'wagering_processing_duration_seconds_count{source="http"} 1',
  );
  expect(metrics).not.toContain('private-wallet');
  expect(lines.join('')).not.toContain('secret SQL');
});
