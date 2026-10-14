import { object, textId, wagerBody } from '../http/contracts.js';
import { ensure } from '../../domain/errors.js';
import { instant } from '../../domain/values.js';
import type { JsonValue } from '../../domain/values.js';
import { canonicalJson } from '../../application/idempotency.js';
import { financialRuntime } from '../runtime/financial-runtime.js';

export const consumerName = 'wager-transactions-v1';
export function parseWagerMessage(body: string) {
  const raw = JSON.parse(body) as unknown;
  const envelope = object(
    raw,
    ['messageId', 'type', 'occurredAt', 'data', 'correlationId'],
    ['messageId', 'type', 'occurredAt', 'data'],
  );
  const messageId = textId(envelope.messageId);
  ensure(envelope.type === 'WagerTransactionRequested');
  ensure(typeof envelope.occurredAt === 'string');
  instant(envelope.occurredAt);
  const data = object(
    envelope.data,
    [
      'providerId',
      'externalTransactionId',
      'idempotencyKey',
      'playerId',
      'walletId',
      'roundId',
      'gameId',
      'kind',
      'money',
      'referenceExternalTransactionId',
    ],
    [
      'providerId',
      'externalTransactionId',
      'idempotencyKey',
      'playerId',
      'walletId',
      'roundId',
      'gameId',
      'kind',
      'money',
    ],
  );
  const { idempotencyKey, ...business } = data;
  return {
    command: wagerBody(business, idempotencyKey),
    context: {
      correlationId:
        envelope.correlationId === undefined
          ? messageId
          : textId(envelope.correlationId),
      causationId: messageId,
    },
    delivery: {
      consumerName,
      messageId,
      payloadHash: financialRuntime.hash(canonicalJson(raw as JsonValue)),
    },
  };
}
