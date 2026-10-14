import { ensure } from './errors.js';

export function identifier(value: string): void {
  ensure(
    typeof value === 'string' && value.length > 0 && value.trim() === value,
  );
}

export function instant(value: string): void {
  ensure(typeof value === 'string' && Number.isFinite(Date.parse(value)));
  ensure(new Date(value).toISOString() === value);
}

export function atOrAfter(value: string, since: string): void {
  instant(value);
  ensure(Date.parse(value) >= Date.parse(since));
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export function immutableJson<T extends JsonValue>(value: T): T {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return value;
  if (typeof value === 'number') {
    ensure(Number.isFinite(value));
    return value;
  }
  if (Array.isArray(value))
    return Object.freeze(
      value.map((item: JsonValue) => immutableJson(item)),
    ) as T;
  ensure(
    typeof value === 'object' &&
      Object.getPrototypeOf(value) === Object.prototype,
  );
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        immutableJson(item as JsonValue),
      ]),
    ),
  ) as T;
}
