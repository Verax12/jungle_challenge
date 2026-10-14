import { ensure } from './errors.js';

export interface MoneyProps {
  readonly amount: string;
  readonly currency: string;
}
const currencies = new Set(['BRL', 'USD', 'EUR']);

export class Money {
  private constructor(
    private readonly cents: bigint,
    public readonly currency: string,
  ) {
    Object.freeze(this);
  }

  static from(props: MoneyProps): Money {
    return Money.parse(props, false);
  }
  static rehydrate(props: MoneyProps): Money {
    return Money.parse(props, true);
  }
  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }

  private static parse(props: MoneyProps, signed: boolean): Money {
    ensure(props && typeof props.amount === 'string', 'INVALID_MONEY');
    ensure(currencies.has(props.currency), 'UNSUPPORTED_CURRENCY');
    const pattern = signed
      ? /^-?(0|[1-9]\d*)\.\d{2}$/
      : /^(0|[1-9]\d*)\.\d{2}$/;
    ensure(pattern.test(props.amount), 'INVALID_MONEY');
    return new Money(BigInt(props.amount.replace('.', '')), props.currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents + other.cents, this.currency);
  }
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents - other.cents, this.currency);
  }
  negate(): Money {
    return new Money(-this.cents, this.currency);
  }
  isZero(): boolean {
    return this.cents === 0n;
  }
  isPositive(): boolean {
    return this.cents > 0n;
  }
  isNegative(): boolean {
    return this.cents < 0n;
  }
  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents < other.cents;
  }
  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents === other.cents;
  }
  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this.currency };
  }
  toString(): string {
    const absolute = this.cents < 0n ? -this.cents : this.cents;
    return `${this.cents < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
  }
  private assertSameCurrency(other: Money): void {
    ensure(this.currency === other.currency, 'CURRENCY_MISMATCH');
  }
}
