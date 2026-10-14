import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SetQueueAttributesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import type { AppConfig } from '../config/environment.js';

export interface QueueNames {
  transactions: string;
  deadLetters: string;
  events: string;
}
export const queueNames: QueueNames = {
  transactions: 'wager-transactions.fifo',
  deadLetters: 'wager-transactions-dlq.fifo',
  events: 'wager-events.fifo',
};
export const maxReceiveCount = 5;
export function createLocalSqsClient(
  config: AppConfig['sqs'],
  operational = false,
): SQSClient {
  return new SQSClient({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    useQueueUrlAsEndpoint: false,
    maxAttempts: operational ? 1 : 3,
    requestHandler: {
      throwOnRequestTimeout: true,
      connectionTimeout: operational ? 1000 : 3000,
      requestTimeout: operational ? 1500 : 5000,
    },
  });
}
export async function queueUrls(
  client: SQSClient,
  names: QueueNames = queueNames,
): Promise<QueueNames> {
  const urls = await Promise.all(
    Object.values(names).map(async (QueueName) => {
      const { QueueUrl } = await client.send(
        new GetQueueUrlCommand({ QueueName }),
      );
      if (!QueueUrl) throw new Error('Queue URL unavailable');
      return QueueUrl;
    }),
  );
  return { transactions: urls[0]!, deadLetters: urls[1]!, events: urls[2]! };
}
export async function provisionQueues(
  client: SQSClient,
  names: QueueNames = queueNames,
): Promise<void> {
  for (const QueueName of Object.values(names))
    await client.send(
      new CreateQueueCommand({
        QueueName,
        Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'false' },
      }),
    );
  const urls = await queueUrls(client, names);
  const { Attributes } = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: urls.deadLetters,
      AttributeNames: ['QueueArn'],
    }),
  );
  if (!Attributes?.QueueArn) throw new Error('DLQ ARN unavailable');
  await client.send(
    new SetQueueAttributesCommand({
      QueueUrl: urls.deadLetters,
      Attributes: { MessageRetentionPeriod: '1209600' },
    }),
  );
  await client.send(
    new SetQueueAttributesCommand({
      QueueUrl: urls.transactions,
      Attributes: {
        VisibilityTimeout: '30',
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: Attributes.QueueArn,
          maxReceiveCount,
        }),
      },
    }),
  );
}
