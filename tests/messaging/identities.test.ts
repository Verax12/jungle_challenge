import { afterEach, beforeEach, expect, test } from 'bun:test';
import { fixture, message, open, receive, send } from './helpers.js';
import { unique } from '../persistence/helpers.js';
import {
  InboxEntity,
  LedgerEntity,
  OutboxEntity,
  ReceiptEntity,
  TransactionEntity,
  WalletEntity,
} from '../../src/adapters/persistence/entities.js';

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
});
afterEach(async () => {
  await f?.close();
});

test.each(['providerId', 'messageId', 'idempotencyKey'])(
  'SQS sends malformed Unicode in %s to DLQ without financial effects',
  async (field) => {
    const w = await open(f);
    const body: Record<string, unknown> = message(w);
    const data = body.data as Record<string, unknown>;
    if (field === 'messageId') body.messageId = 'message-\udfff';
    else data[field] = 'invalid-\ud800';
    await send(f.client, f.urls.transactions, body);
    expect(await f.consumer.once(new AbortController().signal)).toBe(true);
    const dead = await receive(f.client, f.urls.deadLetters);
    expect(dead?.MessageAttributes?.failureCode?.StringValue).toBe(
      'INVALID_INPUT',
    );
    expect(dead?.Body).toBe(JSON.stringify(body));
    expect(await receive(f.client, f.urls.transactions)).toBeUndefined();
    const em = f.orm.em.fork();
    expect(await em.count(InboxEntity, {})).toBe(0);
    expect(await em.count(ReceiptEntity, {})).toBe(0);
    expect(await em.count(TransactionEntity, {})).toBe(1);
    expect(await em.count(LedgerEntity, {})).toBe(1);
    expect(await em.count(OutboxEntity, {})).toBe(2);
    expect((await em.findOneOrFail(WalletEntity, { id: w.id })).balance).toBe(
      '100.00',
    );
  },
);

test('SQS preserves valid Unicode identities and deduplicates their exact redelivery', async () => {
  const playerId = `${unique()}-José-😀-�`;
  const w = await f.service.createWallet(
    { playerId, initialBalance: { amount: '100.00', currency: 'BRL' } },
    { correlationId: unique() },
  );
  const body = {
    ...message(w, {
      providerId: 'provider-😀',
      externalTransactionId: `${unique()}-🎲`,
      idempotencyKey: `${unique()}-💰`,
      roundId: 'rodada-游戏',
      gameId: 'jogo-�',
    }),
    messageId: `${unique()}-📩`,
    correlationId: 'correlation-🔎',
  };
  for (let index = 0; index < 2; index++) {
    await send(f.client, f.urls.transactions, body);
    expect(await f.consumer.once(new AbortController().signal)).toBe(true);
  }
  const em = f.orm.em.fork();
  expect(await em.count(InboxEntity, { messageId: body.messageId })).toBe(1);
  const receipt = await em.findOneOrFail(ReceiptEntity, {
    idempotencyKey: body.data.idempotencyKey,
  });
  expect(receipt.providerId).toBe(body.data.providerId);
  expect(receipt.externalTransactionId).toBe(body.data.externalTransactionId);
  const stored = await em.findOneOrFail(TransactionEntity, {
    id: receipt.transactionId,
  });
  expect(stored.playerId).toBe(playerId);
  expect(stored.roundId).toBe(body.data.roundId);
  expect(stored.gameId).toBe(body.data.gameId);
  expect(await em.count(LedgerEntity, {})).toBe(2);
  expect(await em.count(OutboxEntity, {})).toBe(4);
  expect((await em.findOneOrFail(WalletEntity, { id: w.id })).balance).toBe(
    '75.00',
  );
  expect(f.logs.at(-1)).toMatchObject({
    event: 'message_committed',
    idempotentReplay: true,
  });
  expect(await receive(f.client, f.urls.deadLetters)).toBeUndefined();
  expect(await receive(f.client, f.urls.transactions)).toBeUndefined();
});
