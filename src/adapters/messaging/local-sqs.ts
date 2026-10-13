import { CreateQueueCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { AppConfig } from '../config/environment.js';

export const queueNames = {
  transactions: 'wager-transactions.fifo',
  deadLetters: 'wager-transactions-dlq.fifo',
} as const;

export function createLocalSqsClient(config: AppConfig['sqs']): SQSClient {
  return new SQSClient({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    useQueueUrlAsEndpoint: false,
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 3_000, requestTimeout: 5_000 },
  });
}

export async function provisionQueues(client: SQSClient): Promise<void> {
  for (const QueueName of Object.values(queueNames)) {
    await client.send(
      new CreateQueueCommand({
        QueueName,
        Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'false' },
      }),
    );
  }
}
