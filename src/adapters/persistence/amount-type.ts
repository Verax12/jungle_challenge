import { Type } from '@mikro-orm/core';

export class ExactAmountType extends Type<string, string> {
  override convertToDatabaseValue(value: string): string {
    if (
      typeof value !== 'string' ||
      !/^(0|[1-9]\d{0,35})\.\d{2}$/.test(value)
    ) {
      throw new Error(
        'Persisted amount must be a nonnegative decimal string with 2 places and at most 36 integer digits.',
      );
    }
    return value;
  }
  override convertToJSValue(value: string): string {
    if (
      typeof value !== 'string' ||
      !/^(0|[1-9]\d{0,35})(\.\d{1,2})?$/.test(value)
    ) {
      throw new Error(
        'Database returned an invalid exact monetary representation.',
      );
    }
    const [whole, fraction = ''] = value.split('.');
    return `${whole}.${fraction.padEnd(2, '0')}`;
  }
  override getColumnType(): string {
    return 'money_amount';
  }
  override compareAsType(): string {
    return 'string';
  }
}
