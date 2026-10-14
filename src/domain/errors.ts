export const failureCodes = [
  'INVALID_MONEY',
  'UNSUPPORTED_CURRENCY',
  'INVALID_INPUT',
  'CURRENCY_MISMATCH',
  'WALLET_MISMATCH',
  'INSUFFICIENT_FUNDS',
  'REVERSAL_INSUFFICIENT_FUNDS',
  'REFERENCE_REQUIRED',
  'REFERENCE_NOT_ALLOWED',
  'REFERENCE_NOT_FOUND',
  'REFERENCE_NOT_PROCESSED',
  'REFERENCE_SCOPE_MISMATCH',
  'REFERENCE_KIND_MISMATCH',
  'REFERENCE_AMOUNT_MISMATCH',
  'REFERENCE_ALREADY_REVERSED',
  'IDEMPOTENCY_CONFLICT',
  'INFRASTRUCTURE_PERMANENT',
] as const;

export type FailureCode = (typeof failureCodes)[number];
export type RejectionCode = Exclude<FailureCode, 'INFRASTRUCTURE_PERMANENT'>;

export class DomainError extends Error {
  private constructor(public readonly code: FailureCode) {
    super(code);
    this.name = 'DomainError';
  }
  static for(code: FailureCode): DomainError {
    return new DomainError(code);
  }
}

export class InvalidTransactionStateError extends Error {
  private constructor() {
    super('Invalid transaction transition');
    this.name = 'InvalidTransactionStateError';
  }
  static create(): InvalidTransactionStateError {
    return new InvalidTransactionStateError();
  }
}

export class InvalidMessageStateError extends Error {
  private constructor() {
    super('Invalid message transition');
    this.name = 'InvalidMessageStateError';
  }
  static create(): InvalidMessageStateError {
    return new InvalidMessageStateError();
  }
}

export function ensure(
  condition: unknown,
  code: FailureCode = 'INVALID_INPUT',
): asserts condition {
  if (!condition) throw DomainError.for(code);
}
