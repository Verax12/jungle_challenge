import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { loadConfig } from '../../src/adapters/config/environment.js';
import { connectDatabase } from '../../src/adapters/persistence/database.js';
import {
  createLocalSqsClient,
  provisionQueues,
  queueNames,
} from '../../src/adapters/messaging/local-sqs.js';

const config = loadConfig(process.env);

test('built application responds over HTTP', async () => {
  const url =
    process.env.SMOKE_APP_URL ?? `http://127.0.0.1:${config.http.port}`;
  const response = await fetch(`${url}/health/live`, {
    signal: AbortSignal.timeout(5_000),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('MikroORM executes a query against real PostgreSQL', async () => {
  const orm = await connectDatabase(config.database);
  try {
    const rows = await orm.em
      .getConnection()
      .execute<{ connected: number }[]>('select 1 as connected');
    expect(rows).toEqual([{ connected: 1 }]);
  } finally {
    await orm.close(true);
  }
});

test('queue provisioning is idempotent and both required queues are FIFO', async () => {
  const client = createLocalSqsClient(config.sqs);
  try {
    await provisionQueues(client);
    await provisionQueues(client);
    for (const QueueName of Object.values(queueNames)) {
      const { QueueUrl } = await client.send(
        new GetQueueUrlCommand({ QueueName }),
      );
      expect(QueueUrl).toBeString();
      const { Attributes } = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: QueueUrl!,
          AttributeNames: ['FifoQueue', 'ContentBasedDeduplication'],
        }),
      );
      expect(Attributes?.FifoQueue).toBe('true');
      expect(Attributes?.ContentBasedDeduplication).toBe('false');
    }
  } finally {
    client.destroy();
  }
});

test('SQS sends, receives and acknowledges a probe on an isolated temporary FIFO', async () => {
  const client = createLocalSqsClient(config.sqs);
  let queueUrl: string | undefined;
  try {
    const id = randomUUID();
    const queue = await client.send(
      new CreateQueueCommand({
        QueueName: `smoke-${id}.fifo`,
        Attributes: { FifoQueue: 'true' },
      }),
    );
    queueUrl = queue.QueueUrl;
    expect(queueUrl).toBeString();
    const body = JSON.stringify({ type: 'InfrastructureProbe', id });
    await client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl!,
        MessageBody: body,
        MessageGroupId: 'smoke',
        MessageDeduplicationId: id,
      }),
    );
    const result = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl!,
        WaitTimeSeconds: 5,
        MaxNumberOfMessages: 1,
      }),
    );
    expect(result.Messages).toHaveLength(1);
    expect(result.Messages?.[0]?.Body).toBe(body);
    await client.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl!,
        ReceiptHandle: result.Messages![0]!.ReceiptHandle!,
      }),
    );
  } finally {
    try {
      if (queueUrl)
        await client.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
    } finally {
      client.destroy();
    }
  }
});
