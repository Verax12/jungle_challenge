import { SendMessageCommand } from '@aws-sdk/client-sqs';
import type { SQSClient } from '@aws-sdk/client-sqs';
import type { EventPublisher } from '../../application/ports/outbox-store.js';
import type { OutboxMessage } from '../../domain/messages.js';
import { financialRuntime } from '../runtime/financial-runtime.js';

export class SqsEventPublisher implements EventPublisher {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}
  async publish(message: OutboxMessage): Promise<void> {
    const payload = message.payload as { data?: { walletId?: string } };
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message.payload),
        MessageGroupId: financialRuntime.hash(
          payload.data?.walletId ?? message.aggregateId,
        ),
        MessageDeduplicationId: financialRuntime.hash(message.id),
      }),
    );
  }
}
