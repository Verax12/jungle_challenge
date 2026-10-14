import {
  ensure,
  failureCodes,
  InvalidTransactionStateError,
} from './errors.js';
import type { FailureCode, RejectionCode } from './errors.js';
import { LedgerDirection } from './ledger.js';
import type { Money } from './money.js';
import { atOrAfter, identifier, instant } from './values.js';

export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}
export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}
export interface TransactionProps {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: Money;
  readonly referenceExternalTransactionId?: string;
  readonly createdAt: string;
}
export interface WagerTransactionState extends TransactionProps {
  readonly status: WagerTransactionStatus;
  readonly referenceTransactionId: string | undefined;
  readonly failureCode: FailureCode | undefined;
  readonly processedAt: string | undefined;
}
export type CreateWagerTransactionProps = Omit<TransactionProps, 'kind'> & {
  readonly kind: Exclude<WagerTransactionKind, WagerTransactionKind.Opening>;
};

export class WagerTransaction {
  #state: WagerTransactionState;
  private constructor(state: WagerTransactionState) {
    this.#state = Object.freeze({ ...state });
  }

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    ensure(
      Object.values(WagerTransactionKind).includes(props.kind) &&
        (props.kind as WagerTransactionKind) !== WagerTransactionKind.Opening,
    );
    [
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
    ].forEach(identifier);
    instant(props.createdAt);
    ensure(
      props.kind === WagerTransactionKind.Loss
        ? props.money.isZero()
        : props.money.isPositive(),
      'INVALID_MONEY',
    );
    if (props.referenceExternalTransactionId !== undefined)
      identifier(props.referenceExternalTransactionId);
    const reversal =
      props.kind === WagerTransactionKind.Refund ||
      props.kind === WagerTransactionKind.Rollback;
    ensure(
      !reversal || props.referenceExternalTransactionId !== undefined,
      'REFERENCE_REQUIRED',
    );
    ensure(
      ![WagerTransactionKind.Bet, WagerTransactionKind.Loss].includes(
        props.kind,
      ) || props.referenceExternalTransactionId === undefined,
      'REFERENCE_NOT_ALLOWED',
    );
    ensure(
      props.referenceExternalTransactionId !== props.externalTransactionId,
      'REFERENCE_SCOPE_MISMATCH',
    );
    return WagerTransaction.pending(props);
  }

  static opening(props: {
    id: string;
    walletId: string;
    playerId: string;
    money: Money;
    payloadHash: string;
    createdAt: string;
  }): WagerTransaction {
    [props.id, props.walletId, props.playerId, props.payloadHash].forEach(
      identifier,
    );
    instant(props.createdAt);
    ensure(props.money.isPositive(), 'INVALID_MONEY');
    return WagerTransaction.pending({
      ...props,
      kind: WagerTransactionKind.Opening,
      providerId: 'internal',
      externalTransactionId: props.walletId,
      idempotencyKey: `opening:${props.walletId}`,
      roundId: 'opening',
      gameId: 'internal',
    });
  }
  private static pending(props: TransactionProps): WagerTransaction {
    return new WagerTransaction({
      ...props,
      status: WagerTransactionStatus.Pending,
      referenceTransactionId: undefined,
      failureCode: undefined,
      processedAt: undefined,
    });
  }
  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(state);
  }
  snapshot(): WagerTransactionState {
    return { ...this.#state };
  }
  get id() {
    return this.#state.id;
  }
  get providerId() {
    return this.#state.providerId;
  }
  get externalTransactionId() {
    return this.#state.externalTransactionId;
  }
  get idempotencyKey() {
    return this.#state.idempotencyKey;
  }
  get payloadHash() {
    return this.#state.payloadHash;
  }
  get walletId() {
    return this.#state.walletId;
  }
  get playerId() {
    return this.#state.playerId;
  }
  get roundId() {
    return this.#state.roundId;
  }
  get gameId() {
    return this.#state.gameId;
  }
  get kind() {
    return this.#state.kind;
  }
  get money() {
    return this.#state.money;
  }
  get referenceExternalTransactionId() {
    return this.#state.referenceExternalTransactionId;
  }
  get createdAt() {
    return this.#state.createdAt;
  }
  get status() {
    return this.#state.status;
  }
  get referenceTransactionId() {
    return this.#state.referenceTransactionId;
  }
  get failureCode() {
    return this.#state.failureCode;
  }
  get processedAt() {
    return this.#state.processedAt;
  }

  isTerminal(): boolean {
    return ![
      WagerTransactionStatus.Pending,
      WagerTransactionStatus.PendingReference,
    ].includes(this.status);
  }
  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }
  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }
  matchesPayload(hash: string): boolean {
    return this.payloadHash === hash;
  }
  assertPayload(hash: string): void {
    ensure(this.matchesPayload(hash), 'IDEMPOTENCY_CONFLICT');
  }
  assertMutable(): void {
    if (this.isTerminal()) throw InvalidTransactionStateError.create();
  }

  markProcessed(referenceTransactionId: string | undefined, at: string): void {
    this.assertMutable();
    atOrAfter(at, this.createdAt);
    if (this.referenceExternalTransactionId !== undefined) {
      ensure(referenceTransactionId !== undefined, 'REFERENCE_REQUIRED');
      identifier(referenceTransactionId);
    } else
      ensure(referenceTransactionId === undefined, 'REFERENCE_NOT_ALLOWED');
    this.#state = Object.freeze({
      ...this.#state,
      status: WagerTransactionStatus.Processed,
      referenceTransactionId,
      processedAt: at,
    });
  }
  markPendingReference(): void {
    this.assertMutable();
    ensure(
      this.referenceExternalTransactionId !== undefined,
      'REFERENCE_NOT_ALLOWED',
    );
    this.#state = Object.freeze({
      ...this.#state,
      status: WagerTransactionStatus.PendingReference,
    });
  }
  reject(code: RejectionCode): void {
    this.assertMutable();
    ensure(
      failureCodes.includes(code) &&
        (code as FailureCode) !== 'INFRASTRUCTURE_PERMANENT',
    );
    this.#state = Object.freeze({
      ...this.#state,
      status: WagerTransactionStatus.Rejected,
      failureCode: code,
    });
  }
  fail(code: 'INFRASTRUCTURE_PERMANENT'): void {
    this.assertMutable();
    ensure(code === 'INFRASTRUCTURE_PERMANENT');
    this.#state = Object.freeze({
      ...this.#state,
      status: WagerTransactionStatus.Failed,
      failureCode: code,
    });
  }

  ledgerDirectionFor(
    reference?: WagerTransaction,
    alreadyReversed?: boolean,
  ): LedgerDirection | undefined {
    this.assertMutable();
    if (this.referenceExternalTransactionId !== undefined) {
      ensure(reference, 'REFERENCE_NOT_FOUND');
      ensure(
        reference.id !== this.id &&
          reference.providerId === this.providerId &&
          reference.externalTransactionId ===
            this.referenceExternalTransactionId &&
          reference.playerId === this.playerId &&
          reference.walletId === this.walletId &&
          reference.roundId === this.roundId,
        'REFERENCE_SCOPE_MISMATCH',
      );
      ensure(
        reference.money.currency === this.money.currency,
        'CURRENCY_MISMATCH',
      );
      ensure(
        reference.status === WagerTransactionStatus.Processed,
        'REFERENCE_NOT_PROCESSED',
      );
      const allowed =
        this.kind === WagerTransactionKind.Rollback
          ? [
              WagerTransactionKind.Bet,
              WagerTransactionKind.Win,
              WagerTransactionKind.Refund,
            ]
          : [WagerTransactionKind.Bet];
      ensure(allowed.includes(reference.kind), 'REFERENCE_KIND_MISMATCH');
      if (this.requiresReference()) {
        ensure(this.money.equals(reference.money), 'REFERENCE_AMOUNT_MISMATCH');
        ensure(typeof alreadyReversed === 'boolean');
        ensure(!alreadyReversed, 'REFERENCE_ALREADY_REVERSED');
      }
    } else ensure(reference === undefined, 'REFERENCE_NOT_ALLOWED');

    switch (this.kind) {
      case WagerTransactionKind.Loss:
        return undefined;
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Rollback:
        return reference!.kind === WagerTransactionKind.Bet
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;
      default:
        return LedgerDirection.Credit;
    }
  }
}
