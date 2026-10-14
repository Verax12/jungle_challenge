import { expect } from 'bun:test';
import {
  DeleteQueueCommand,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import type { SQSClient, Message } from '@aws-sdk/client-sqs';
import { disposableDatabase, unique, sql } from '../persistence/helpers.js';
import { loadConfig } from '../../src/adapters/config/environment.js';
import {
  createLocalSqsClient,
  provisionQueues,
  queueUrls,
} from '../../src/adapters/messaging/local-sqs.js';
import { createFinancialProcessing } from '../../src/composition/financial-processing.js';
import { SqsConsumer } from '../../src/adapters/messaging/sqs-consumer.js';
import { PublishOutbox } from '../../src/application/publish-outbox.js';
import { MikroOutboxUnitOfWork } from '../../src/adapters/persistence/outbox-unit-of-work.js';
import { SqsEventPublisher } from '../../src/adapters/messaging/sqs-event-publisher.js';
import { financialRuntime } from '../../src/adapters/runtime/financial-runtime.js';
export async function fixture() {
  const db = await disposableDatabase();
  const client = createLocalSqsClient(loadConfig(process.env).sqs);
  const id = unique();
  const names = {
    transactions: `test-${id}-in.fifo`,
    deadLetters: `test-${id}-dlq.fifo`,
    events: `test-${id}-out.fifo`,
  };
  await db.orm.getMigrator().up();
  await provisionQueues(client, names);
  const urls = await queueUrls(client, names);
  const service = createFinancialProcessing(db.orm);
  const logs: Record<string, unknown>[] = [];
  const consumer = new SqsConsumer(client, urls, service, (e) => logs.push(e));
  const publisher = new PublishOutbox(
    new MikroOutboxUnitOfWork(db.orm),
    new SqsEventPublisher(client, urls.events),
    financialRuntime,
  );
  return {
    ...db,
    client,
    names,
    urls,
    service,
    logs,
    consumer,
    publisher,
    async close() {
      try {
        const mismatches = await sql(
          db.orm.em.fork(),
          `select w.id from wallets w where w.balance <> coalesce((select sum(case direction when 'CREDIT' then amount else -amount end) from wallet_ledger_entries where wallet_id=w.id),0)`,
        );
        expect(mismatches).toEqual([]);
      } finally {
        try {
          for (const QueueUrl of Object.values(urls))
            await client.send(new DeleteQueueCommand({ QueueUrl }));
        } finally {
          client.destroy();
          await db.close();
        }
      }
    },
  };
}
export async function open(f: Awaited<ReturnType<typeof fixture>>) {
  return f.service.createWallet(
    {
      playerId: unique(),
      initialBalance: { amount: '100.00', currency: 'BRL' },
    },
    { correlationId: unique() },
  );
}
export function message(
  w: Awaited<ReturnType<typeof open>>,
  extra: Record<string, unknown> = {},
) {
  return {
    messageId: unique(),
    type: 'WagerTransactionRequested',
    occurredAt: new Date().toISOString(),
    data: {
      providerId: 'provider',
      externalTransactionId: unique(),
      idempotencyKey: unique(),
      playerId: w.playerId,
      walletId: w.id,
      roundId: 'round',
      gameId: 'game',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
      ...extra,
    },
  };
}
export async function send(
  client: SQSClient,
  url: string,
  body: unknown,
  group = unique(),
) {
  return client.send(
    new SendMessageCommand({
      QueueUrl: url,
      MessageBody: typeof body === 'string' ? body : JSON.stringify(body),
      MessageGroupId: group,
      MessageDeduplicationId: unique(),
    }),
  );
}
export async function receive(
  client: SQSClient,
  url: string,
  wait = 0,
): Promise<Message | undefined> {
  const r = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: url,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: wait,
      MessageAttributeNames: ['All'],
      MessageSystemAttributeNames: ['All'],
    }),
  );
  return r.Messages?.[0];
}
export async function drain(client: SQSClient, url: string) {
  const messages: Message[] = [];
  for (let i = 0; i < 30; i++) {
    const m = await receive(client, url);
    if (!m) break;
    messages.push(m);
    await client.send(
      new DeleteMessageCommand({
        QueueUrl: url,
        ReceiptHandle: m.ReceiptHandle!,
      }),
    );
  }
  return messages;
}
export async function publishAll(f: Awaited<ReturnType<typeof fixture>>) {
  for (let i = 0; i < 30; i++) if (!(await f.publisher.once())) return;
  throw new Error('Publisher did not drain');
}
