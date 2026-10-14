import { ensure, InvalidMessageStateError } from './errors.js';
import type { IntegrationEvent } from './events.js';
import { atOrAfter, identifier, immutableJson, instant } from './values.js';
import type { JsonValue } from './values.js';

export interface InboxMessageState {
  readonly messageId: string;
  readonly consumerName: string;
  readonly payloadHash: string;
  readonly receivedAt: string;
  readonly processedAt: string | undefined;
}
export class InboxMessage {
  #state: InboxMessageState;
  private constructor(state: InboxMessageState) {
    this.#state = Object.freeze({ ...state });
  }
  static receive(props: Omit<InboxMessageState, 'processedAt'>): InboxMessage {
    [props.messageId, props.consumerName, props.payloadHash].forEach(
      identifier,
    );
    instant(props.receivedAt);
    return new InboxMessage({ ...props, processedAt: undefined });
  }
  static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(state);
  }
  snapshot(): InboxMessageState {
    return { ...this.#state };
  }
  get messageId() {
    return this.#state.messageId;
  }
  get consumerName() {
    return this.#state.consumerName;
  }
  get payloadHash() {
    return this.#state.payloadHash;
  }
  get receivedAt() {
    return this.#state.receivedAt;
  }
  get processedAt() {
    return this.#state.processedAt;
  }
  isProcessed(): boolean {
    return this.processedAt !== undefined;
  }
  assertPayload(hash: string): void {
    ensure(this.payloadHash === hash, 'IDEMPOTENCY_CONFLICT');
  }
  markProcessed(at: string): void {
    if (this.isProcessed()) throw InvalidMessageStateError.create();
    atOrAfter(at, this.receivedAt);
    this.#state = Object.freeze({ ...this.#state, processedAt: at });
  }
}

export interface OutboxMessageState {
  readonly id: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: JsonValue;
  readonly occurredAt: string;
  readonly attempts: number;
  readonly nextAttemptAt: string | undefined;
  readonly publishedAt: string | undefined;
}
export interface BackoffPolicy {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}
export class OutboxMessage {
  #state: OutboxMessageState;
  private constructor(state: OutboxMessageState) {
    this.#state = Object.freeze({
      ...state,
      payload: immutableJson(state.payload),
    });
  }
  static enqueue(event: IntegrationEvent<JsonValue>): OutboxMessage {
    return new OutboxMessage({
      id: event.eventId,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.toJSON(),
      occurredAt: event.occurredAt,
      attempts: 0,
      nextAttemptAt: undefined,
      publishedAt: undefined,
    });
  }
  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(state);
  }
  snapshot(): OutboxMessageState {
    return { ...this.#state };
  }
  get id() {
    return this.#state.id;
  }
  get aggregateId() {
    return this.#state.aggregateId;
  }
  get eventType() {
    return this.#state.eventType;
  }
  get payload() {
    return this.#state.payload;
  }
  get occurredAt() {
    return this.#state.occurredAt;
  }
  get attempts() {
    return this.#state.attempts;
  }
  get nextAttemptAt() {
    return this.#state.nextAttemptAt;
  }
  get publishedAt() {
    return this.#state.publishedAt;
  }
  isPending(): boolean {
    return this.publishedAt === undefined;
  }
  isDue(now: string): boolean {
    instant(now);
    return (
      this.isPending() &&
      Date.parse(now) >= Date.parse(this.nextAttemptAt ?? this.occurredAt)
    );
  }
  private assertPending(): void {
    if (!this.isPending()) throw InvalidMessageStateError.create();
  }
  markPublished(at: string): void {
    this.assertPending();
    atOrAfter(at, this.occurredAt);
    this.#state = Object.freeze({
      ...this.#state,
      publishedAt: at,
      nextAttemptAt: undefined,
    });
  }
  scheduleRetry(now: string, policy: BackoffPolicy): void {
    this.assertPending();
    atOrAfter(now, this.occurredAt);
    ensure(
      Number.isSafeInteger(policy.baseDelayMs) &&
        policy.baseDelayMs > 0 &&
        Number.isSafeInteger(policy.maxDelayMs) &&
        policy.maxDelayMs >= policy.baseDelayMs,
    );
    ensure(Number.isSafeInteger(this.attempts + 1));
    const delay = Math.min(
      policy.maxDelayMs,
      policy.baseDelayMs * 2 ** Math.min(this.attempts, 1023),
    );
    const next = Date.parse(now) + delay;
    ensure(
      Number.isSafeInteger(next) && Math.abs(next) <= 8_640_000_000_000_000,
    );
    this.#state = Object.freeze({
      ...this.#state,
      attempts: this.attempts + 1,
      nextAttemptAt: new Date(next).toISOString(),
    });
  }
}
