import { expect, test } from 'bun:test';
import { Money } from '../../src/domain/money.js';
import { expectCode, money } from './helpers.js';

test('exact cents beyond Number safe precision and no cumulative fractional drift', () => {
  const huge = money('900719925474099312345678901234567890.99');
  expect(huge.add(money('0.01')).toString()).toBe(
    '900719925474099312345678901234567891.00',
  );
  expect(huge.subtract(money('0.99')).toString()).toBe(
    '900719925474099312345678901234567890.00',
  );
  let total = Money.zero('BRL');
  for (let i = 0; i < 1000; i++) total = total.add(money('0.01'));
  expect(total.toString()).toBe('10.00');
});

test('arithmetic preserves immutable operands and canonical JSON', () => {
  const original = money('1.25');
  const sum = original.add(money('2.10'));
  expect(sum.toString()).toBe('3.35');
  expect(original.toString()).toBe('1.25');
  expect(original.subtract(money('2.00')).toString()).toBe('-0.75');
  expect(original.negate().toString()).toBe('-1.25');
  expect(original.add(Money.zero('BRL'))).not.toBe(original);
  expect(JSON.stringify(sum)).toBe('{"amount":"3.35","currency":"BRL"}');
  expect(Object.isFrozen(original)).toBe(true);
  expect(() => Object.assign(original, { currency: 'USD' })).toThrow();
  const props = original.toJSON();
  Object.assign(props, { amount: '999.00' });
  expect(original.toString()).toBe('1.25');
});

test('signs, equality, comparison and negative rehydration are exact', () => {
  expect(Money.zero('BRL').isZero()).toBe(true);
  expect(Money.zero('BRL').negate().toString()).toBe('0.00');
  expect(money('0.01').isPositive()).toBe(true);
  const negative = Money.rehydrate({ amount: '-0.01', currency: 'BRL' });
  expect(negative.isNegative()).toBe(true);
  expect(negative.isLessThan(Money.zero('BRL'))).toBe(true);
  expect(negative.equals(money('0.01').negate())).toBe(true);
  expect(negative.equals(money('0.01'))).toBe(false);
});

test.each([
  '',
  ' ',
  'NaN',
  'Infinity',
  '-Infinity',
  '1e2',
  '1E+2',
  '1',
  '1.0',
  '1.001',
  '1.005',
  '.25',
  '00.00',
  '01.00',
  '+1.00',
  '-0.00',
  '-1.00',
  ' 1.00',
  '1.00 ',
  '1,00',
  '0x10',
  '1.00\n',
])('rejects invalid contract amount %j without rounding', (amount) =>
  expectCode(() => money(amount), 'INVALID_MONEY'),
);
test('runtime monetary numbers and malformed props are rejected', () => {
  expectCode(() => money(25 as unknown as string), 'INVALID_MONEY');
  expectCode(
    () => Money.from(null as unknown as { amount: string; currency: string }),
    'INVALID_MONEY',
  );
});
test.each(['BRL', 'USD', 'EUR'])(
  'supports explicit currency %s',
  (currency) => {
    expect(money('1.00', currency).toJSON()).toEqual({
      amount: '1.00',
      currency,
    });
  },
);
test.each(['brl', 'ABC', '', 'JPY'])(
  'rejects unsupported currency %j',
  (currency) =>
    expectCode(() => money('1.00', currency), 'UNSUPPORTED_CURRENCY'),
);
test.each(['add', 'subtract', 'equals', 'isLessThan'] as const)(
  '%s rejects mixed currencies',
  (operation) => {
    expectCode(
      () => money('1.00')[operation](money('1.00', 'USD')),
      'CURRENCY_MISMATCH',
    );
  },
);
test('signed rehydration still enforces exact representation', () => {
  expectCode(
    () => Money.rehydrate({ amount: '-1.001', currency: 'BRL' }),
    'INVALID_MONEY',
  );
});
