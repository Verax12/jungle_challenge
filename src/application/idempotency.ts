import type { MoneyProps } from '../domain/money.js';
import type { FailureCode } from '../domain/errors.js';
import type { WagerTransactionStatus } from '../domain/wager-transaction.js';
import type { JsonValue } from '../domain/values.js';

export interface RequestIdentity {
  readonly idempotencyKey: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
}
export interface ProcessingResult {
  readonly transactionId: string;
  readonly status: WagerTransactionStatus;
  readonly failureCode?: FailureCode;
  readonly balance: MoneyProps;
  readonly walletVersion: number;
}
export interface ProcessingReceipt extends RequestIdentity {
  readonly payloadHash: string;
  readonly result: ProcessingResult;
}
export class IdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency identity or payload conflict');
    this.name = 'IdempotencyConflictError';
  }
}
export function replay(
  receipts: ProcessingReceipt[],
  identity: RequestIdentity,
  hash: string,
): ProcessingResult | undefined {
  if (receipts.length === 0) return undefined;
  const receipt = receipts[0]!;
  if (
    receipts.length !== 1 ||
    receipt.idempotencyKey !== identity.idempotencyKey ||
    receipt.providerId !== identity.providerId ||
    receipt.externalTransactionId !== identity.externalTransactionId ||
    receipt.payloadHash !== hash
  )
    throw new IdempotencyConflictError();
  return receipt.result;
}
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, JsonValue>)[key]!)}`,
      )
      .join(',')}}`;
  return JSON.stringify(value);
}
