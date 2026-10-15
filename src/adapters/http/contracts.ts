import { DomainError, ensure } from '../../domain/errors.js';
import { Money } from '../../domain/money.js';
import type { MoneyProps } from '../../domain/money.js';
import type { ProcessWagerCommand } from '../../application/financial-processing.js';
import { WagerTransactionKind } from '../../domain/wager-transaction.js';

export function textId(value: unknown): string {
  ensure(
    typeof value === 'string' &&
      value.length >= 1 &&
      value.length <= 256 &&
      value.trim() === value &&
      !/[\uD800-\uDFFF]/u.test(value) &&
      [...value].every(
        (character) =>
          character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      ),
  );
  return value;
}
export function object(
  value: unknown,
  allowed: string[],
  required = allowed,
): Record<string, unknown> {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value));
  const data = value as Record<string, unknown>;
  ensure(
    Object.keys(data).every((key) => allowed.includes(key)) &&
      required.every((key) => Object.hasOwn(data, key)),
  );
  return data;
}
function money(value: unknown): MoneyProps {
  const data = object(value, ['amount', 'currency']);
  ensure(
    typeof data.amount === 'string' && typeof data.currency === 'string',
    'INVALID_MONEY',
  );
  const result = Money.from({ amount: data.amount, currency: data.currency });
  ensure(data.amount.split('.')[0]!.length <= 36, 'INVALID_MONEY');
  return result.toJSON();
}
export function walletBody(body: unknown) {
  const data = object(body, ['playerId', 'initialBalance']);
  return {
    playerId: textId(data.playerId),
    initialBalance: money(data.initialBalance),
  };
}
export function wagerBody(body: unknown, key: unknown): ProcessWagerCommand {
  const fields = [
    'providerId',
    'externalTransactionId',
    'playerId',
    'walletId',
    'roundId',
    'gameId',
    'kind',
    'money',
  ];
  const data = object(
    body,
    [...fields, 'referenceExternalTransactionId'],
    fields,
  );
  ensure(
    Object.values(WagerTransactionKind).includes(
      data.kind as WagerTransactionKind,
    ) && data.kind !== WagerTransactionKind.Opening,
  );
  return {
    providerId: textId(data.providerId),
    externalTransactionId: textId(data.externalTransactionId),
    playerId: textId(data.playerId),
    walletId: textId(data.walletId),
    roundId: textId(data.roundId),
    gameId: textId(data.gameId),
    kind: data.kind as ProcessWagerCommand['kind'],
    money: money(data.money),
    idempotencyKey: textId(key),
    ...(Object.hasOwn(data, 'referenceExternalTransactionId')
      ? {
          referenceExternalTransactionId: textId(
            data.referenceExternalTransactionId,
          ),
        }
      : {}),
  };
}
export function ledgerQuery(value: unknown) {
  const data = object(value, ['cursor', 'limit'], []);
  if (
    data.limit !== undefined &&
    (typeof data.limit !== 'string' || !/^[1-9]\d{0,2}$/.test(data.limit))
  )
    throw DomainError.for('INVALID_INPUT');
  const limit = data.limit === undefined ? 50 : Number(data.limit);
  ensure(limit <= 100);
  ensure(
    data.cursor === undefined ||
      (typeof data.cursor === 'string' &&
        data.cursor.length > 0 &&
        data.cursor.length <= 2048),
  );
  return { limit, cursor: data.cursor as string | undefined };
}
