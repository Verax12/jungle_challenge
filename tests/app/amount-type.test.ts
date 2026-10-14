import { expect, test } from 'bun:test';
import { ExactAmountType } from '../../src/adapters/persistence/amount-type.js';

const type = new ExactAmountType();
test.each(['0.00', '0.01', '999999999999999999999999999999999999.99'])(
  'exact SQL type preserves %s',
  (amount) => {
    expect(type.convertToDatabaseValue(amount)).toBe(amount);
    expect(type.convertToJSValue(amount)).toBe(amount);
  },
);
test.each([
  '-1.00',
  '1.001',
  '1e2',
  '1',
  'NaN',
  'Infinity',
  '1000000000000000000000000000000000000.00',
])('SQL boundary rejects %s', (amount) => {
  expect(() => type.convertToDatabaseValue(amount)).toThrow();
});
test('database hydration normalizes scale without parsing money as number', () => {
  expect(type.convertToJSValue('1')).toBe('1.00');
  expect(type.convertToJSValue('1.2')).toBe('1.20');
  expect(() => type.convertToJSValue(1.2 as unknown as string)).toThrow();
  expect(() => type.convertToDatabaseValue(1.2 as unknown as string)).toThrow();
});
