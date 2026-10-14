import { ensure } from '../domain/errors.js';
import { instant } from '../domain/values.js';

export const referencePolicy = Object.freeze({
  initialDelayMs: 1_000,
  maxDelayMs: 60_000,
  ttlMs: 86_400_000,
});
export interface ReferenceJob {
  transactionId: string;
  correlationId: string;
  causationId: string | null;
  attempts: number;
  nextAttemptAt: string;
  expiresAt: string;
  completedAt: string | null;
}
export function nextReferenceAttempt(
  now: string,
  attempts: number,
  expiresAt: string,
): string {
  instant(now);
  instant(expiresAt);
  ensure(Number.isSafeInteger(attempts) && attempts >= 0);
  const delay = Math.min(
    referencePolicy.initialDelayMs * 2 ** Math.min(attempts, 6),
    referencePolicy.maxDelayMs,
  );
  return new Date(
    Math.min(Date.parse(now) + delay, Date.parse(expiresAt)),
  ).toISOString();
}
export function newReferenceJob(
  transactionId: string,
  createdAt: string,
  context: { correlationId: string; causationId?: string },
): ReferenceJob {
  instant(createdAt);
  const expiresAt = new Date(
    Date.parse(createdAt) + referencePolicy.ttlMs,
  ).toISOString();
  return {
    transactionId,
    correlationId: context.correlationId,
    causationId: context.causationId ?? null,
    attempts: 0,
    expiresAt,
    nextAttemptAt: nextReferenceAttempt(createdAt, 0, expiresAt),
    completedAt: null,
  };
}
