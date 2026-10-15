import { expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { loadConfig } from '../../src/adapters/config/environment.js';
import { connectDatabase } from '../../src/adapters/persistence/database.js';
import {
  createLocalSqsClient,
  queueUrls,
} from '../../src/adapters/messaging/local-sqs.js';
import type {
  FinancialQueries,
  WalletView,
  TransactionView,
} from '../../src/application/ports/financial-queries.js';

export type Kind = 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';
export interface Command {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: Kind;
  money: { amount: string; currency: string };
  referenceExternalTransactionId?: string;
}
export interface Outcome {
  transactionId: string;
  status: string;
  balance: { amount: string; currency: string };
  walletVersion: number;
  failureCode?: string;
  idempotentReplay: boolean;
}
export type LedgerPage = Awaited<ReturnType<FinancialQueries['ledger']>>;
export const unique = () => randomUUID();

export function command(
  wallet: WalletView,
  overrides: Partial<Command> = {},
): Command {
  return {
    providerId: 'production-tests',
    externalTransactionId: unique(),
    idempotencyKey: unique(),
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: wallet.id,
    gameId: 'production-tests',
    kind: 'BET',
    money: { amount: '25.00', currency: 'BRL' },
    ...overrides,
  };
}

export async function until<T>(
  read: () => Promise<T>,
  accepts: (value: T) => boolean,
  label: string,
  timeout = 20000,
): Promise<T> {
  const expires = Date.now() + timeout;
  do {
    const value = await read();
    if (accepts(value)) return value;
    await Bun.sleep(100);
  } while (Date.now() < expires);
  throw new Error(`Production stack did not reach: ${label}`);
}

export async function productionStack() {
  const config = loadConfig(process.env);
  const base = process.env.SMOKE_APP_URL;
  if (process.env.PRODUCTION_TESTS !== '1' || !base)
    throw new Error(
      'Use PRODUCTION_TESTS=1 and SMOKE_APP_URL against an exclusive local test stack with migrations and all workers running. These tests create financial records and consume their own published events.',
    );
  const url = new URL(base);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', 'app'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !['127.0.0.1', 'localhost', 'postgres'].includes(config.database.host)
  )
    throw new Error(
      'Production tests require the exclusive local Compose stack.',
    );
  const orm = await connectDatabase(config.database, true);
  const client = createLocalSqsClient(config.sqs);
  try {
    const urls = await queueUrls(client);
    async function http<T>(path: string, body?: unknown, key?: string) {
      const response = await fetch(`${url.origin}${path}`, {
        ...(body === undefined
          ? {}
          : { method: 'POST', body: JSON.stringify(body) }),
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        signal: AbortSignal.timeout(5000),
      });
      return { status: response.status, body: (await response.json()) as T };
    }
    async function read<T>(statement: string, values: unknown[] = []) {
      if (!/^select\s/i.test(statement))
        throw new Error('Production test SQL must be read-only SELECT.');
      return orm.em.getConnection().execute<T[]>(statement, values);
    }
    const stack = {
      http,
      read,
      async open() {
        const response = await http<WalletView>('/wallets', {
          playerId: unique(),
          initialBalance: { amount: '100.00', currency: 'BRL' },
        });
        expect(response.status).toBe(201);
        expect(response.body.balance).toEqual({
          amount: '100.00',
          currency: 'BRL',
        });
        return response.body;
      },
      submit(input: Command) {
        const { idempotencyKey, ...body } = input;
        return http<Outcome>('/wagering/transactions', body, idempotencyKey);
      },
      external(input: Command) {
        return http<TransactionView>(
          `/providers/${input.providerId}/wagering/transactions/${input.externalTransactionId}`,
        );
      },
      envelope(input: Command) {
        return {
          messageId: unique(),
          type: 'WagerTransactionRequested',
          occurredAt: new Date().toISOString(),
          data: input,
        };
      },
      async send(envelope: { data: Command; messageId: string }) {
        await client.send(
          new SendMessageCommand({
            QueueUrl: urls.transactions,
            MessageBody: JSON.stringify(envelope),
            MessageGroupId: envelope.data.walletId,
            MessageDeduplicationId: unique(),
          }),
        );
      },
      async sourceDrained() {
        await until(
          async () => {
            const { Attributes } = await client.send(
              new GetQueueAttributesCommand({
                QueueUrl: urls.transactions,
                AttributeNames: [
                  'ApproximateNumberOfMessages',
                  'ApproximateNumberOfMessagesNotVisible',
                  'ApproximateNumberOfMessagesDelayed',
                ],
              }),
            );
            return Attributes;
          },
          (attributes) =>
            attributes?.ApproximateNumberOfMessages === '0' &&
            attributes.ApproximateNumberOfMessagesNotVisible === '0' &&
            attributes.ApproximateNumberOfMessagesDelayed === '0',
          'all submitted commands acknowledged',
        );
      },
      async deadLettersEmpty() {
        const result = await client.send(
          new ReceiveMessageCommand({
            QueueUrl: urls.deadLetters,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 1,
          }),
        );
        for (const message of result.Messages ?? []) {
          if (message.ReceiptHandle)
            await client.send(
              new ChangeMessageVisibilityCommand({
                QueueUrl: urls.deadLetters,
                ReceiptHandle: message.ReceiptHandle,
                VisibilityTimeout: 0,
              }),
            );
        }
        expect(result.Messages ?? []).toEqual([]);
      },
      async reconcile(walletId: string, amount: string, entries: number) {
        const result = await http<
          Awaited<ReturnType<FinancialQueries['reconciliation']>>
        >(`/wallets/${walletId}/reconciliation`, {});
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({
          walletId,
          storedBalance: { amount, currency: 'BRL' },
          calculatedBalance: { amount, currency: 'BRL' },
          difference: { amount: '0.00', currency: 'BRL' },
          consistent: true,
          checkedEntries: entries,
        });
        expect(
          await read<{ consistent: boolean }>(
            `select w.balance = coalesce((select sum(case direction when 'CREDIT' then amount else -amount end)
             from wallet_ledger_entries where wallet_id=w.id),0) as consistent from wallets w where w.id=?`,
            [walletId],
          ),
        ).toEqual([{ consistent: true }]);
      },
      async counts(walletId: string) {
        const rows = await read<{
          transactions: string;
          receipts: string;
          ledger: string;
        }>(
          `select count(*)::text as transactions,
           (select count(*)::text from processing_receipts r join wager_transactions t on t.id=r.transaction_id where t.wallet_id=?) as receipts,
           (select count(*)::text from wallet_ledger_entries where wallet_id=?) as ledger
           from wager_transactions where wallet_id=?`,
          [walletId, walletId, walletId],
        );
        return rows[0];
      },
      async events(walletId: string, expectedTypes: Record<string, number>) {
        type Event = { eventId: string; data: { walletId: string } };
        type Row = {
          id: string;
          event_type: string;
          payload: Event;
          published_at: Date | null;
        };
        const count = Object.values(expectedTypes).reduce(
          (sum, n) => sum + n,
          0,
        );
        const rows = await until(
          () =>
            read<Row>(
              "select id,event_type,payload,published_at from outbox_messages where payload->'data'->>'walletId'=? order by id",
              [walletId],
            ),
          (items) =>
            items.length === count &&
            items.every((item) => item.published_at !== null),
          'production publisher confirms every committed event',
        );
        const counts: Record<string, number> = {};
        for (const row of rows)
          counts[row.event_type] = (counts[row.event_type] ?? 0) + 1;
        expect(counts).toEqual(expectedTypes);
        const expected = new Map(rows.map((row) => [row.id, row.payload]));
        const received = new Set<string>();
        const unrelated: string[] = [];
        try {
          await until(
            async () => {
              const result = await client.send(
                new ReceiveMessageCommand({
                  QueueUrl: urls.events,
                  MaxNumberOfMessages: 10,
                  WaitTimeSeconds: 1,
                  VisibilityTimeout: 30,
                }),
              );
              for (const message of result.Messages ?? []) {
                if (!message.ReceiptHandle)
                  throw new Error('Event receipt missing.');
                let event: Event | undefined;
                try {
                  event = JSON.parse(message.Body ?? '') as Event;
                } catch {
                  event = undefined;
                }
                if (event?.data?.walletId !== walletId) {
                  unrelated.push(message.ReceiptHandle);
                  continue;
                }
                expect(expected.has(event.eventId)).toBe(true);
                expect(event).toEqual(expected.get(event.eventId)!);
                received.add(event.eventId);
                await client.send(
                  new DeleteMessageCommand({
                    QueueUrl: urls.events,
                    ReceiptHandle: message.ReceiptHandle,
                  }),
                );
              }
              return received.size;
            },
            (size) => size === expected.size,
            'all committed event IDs delivered by the production publisher',
          );
          expect([...received].sort()).toEqual([...expected.keys()].sort());
        } finally {
          for (const ReceiptHandle of unrelated)
            await client.send(
              new ChangeMessageVisibilityCommand({
                QueueUrl: urls.events,
                ReceiptHandle,
                VisibilityTimeout: 0,
              }),
            );
        }
      },
      async close() {
        client.destroy();
        await orm.close(true);
      },
    };
    expect((await http('/health/ready')).status).toBe(200);
    return stack;
  } catch (error) {
    client.destroy();
    await orm.close(true);
    throw error;
  }
}
