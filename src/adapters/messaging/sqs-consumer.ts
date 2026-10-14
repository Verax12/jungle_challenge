import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import type { SQSClient, Message } from '@aws-sdk/client-sqs';
import { setTimeout as sleep } from 'node:timers/promises';
import type { FinancialProcessing } from '../../application/financial-processing.js';
import { IdempotencyConflictError } from '../../application/idempotency.js';
import {
  FinancialConflictError,
  WalletNotFoundError,
} from '../../application/ports/financial-store.js';
import { DomainError } from '../../domain/errors.js';
import { financialRuntime } from '../runtime/financial-runtime.js';
import { parseWagerMessage } from './request-contract.js';
import { maxReceiveCount } from './local-sqs.js';
import type { QueueNames } from './local-sqs.js';

export function permanentMessageFailure(error: unknown): string | undefined {
  if (error instanceof DomainError) return error.code;
  if (
    error instanceof IdempotencyConflictError ||
    error instanceof FinancialConflictError
  )
    return 'IDEMPOTENCY_CONFLICT';
  if (error instanceof WalletNotFoundError) return 'WALLET_NOT_FOUND';
  if (error instanceof SyntaxError) return 'INVALID_JSON';
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^(22|23|42)[A-Z0-9]{3}$/.test(code))
    return 'INFRASTRUCTURE_PERMANENT';
  return undefined;
}
export function visibilityBackoff(receiveCount: number): number {
  return Math.min(60, 2 ** Math.min(Math.max(0, receiveCount - 1), 6));
}
export class SqsConsumer {
  constructor(
    private readonly client: SQSClient,
    private readonly urls: QueueNames,
    private readonly processing: Pick<FinancialProcessing, 'process'>,
    private readonly report: (event: Record<string, unknown>) => void,
  ) {}
  private visibility(message: Message, seconds: number) {
    return this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.urls.transactions,
        ReceiptHandle: message.ReceiptHandle!,
        VisibilityTimeout: seconds,
      }),
    );
  }
  private async renew(message: Message, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await sleep(10000, undefined, { signal });
      } catch {
        if (signal.aborted) return;
      }
      try {
        await this.visibility(message, 30);
      } catch {
        this.report({
          level: 'error',
          event: 'visibility_renewal_failed',
          sqsMessageId: message.MessageId,
        });
      }
    }
  }
  async once(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    const received = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.urls.transactions,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 2,
        VisibilityTimeout: 30,
        MessageSystemAttributeNames: [
          'ApproximateReceiveCount',
          'MessageGroupId',
        ],
      }),
      { abortSignal: signal },
    );
    const message = received.Messages?.[0];
    if (!message) return false;
    if (!message.ReceiptHandle) throw new Error('SQS receipt missing');
    if (signal.aborted) {
      await this.visibility(message, 0);
      return false;
    }
    const lease = new AbortController();
    const renewal = this.renew(message, lease.signal);
    let failure: unknown;
    let failed = false;
    let outcome: Record<string, unknown> = { sqsMessageId: message.MessageId };
    try {
      const parsed = parseWagerMessage(message.Body ?? '');
      outcome = {
        ...outcome,
        messageId: parsed.delivery.messageId,
        correlationId: parsed.context.correlationId,
        walletId: parsed.command.walletId,
        providerId: parsed.command.providerId,
      };
      const result = await this.processing.process(
        parsed.command,
        parsed.context,
        parsed.delivery,
      );
      outcome = {
        ...outcome,
        transactionId: result.transactionId,
        status: result.status,
        idempotentReplay: result.idempotentReplay,
      };
    } catch (error) {
      failure = error;
      failed = true;
    } finally {
      lease.abort();
      await renewal;
    }
    if (failed) {
      const count = Number(message.Attributes?.ApproximateReceiveCount ?? '1');
      const permanent = permanentMessageFailure(failure);
      if (permanent || count >= maxReceiveCount) {
        const code = permanent ?? 'RETRIES_EXHAUSTED';
        await this.client.send(
          new SendMessageCommand({
            QueueUrl: this.urls.deadLetters,
            MessageBody: message.Body ?? 'null',
            MessageGroupId: financialRuntime.hash(
              message.Attributes?.MessageGroupId ?? 'invalid',
            ),
            MessageDeduplicationId: financialRuntime.hash(
              `${message.MessageId}:${message.Body}`,
            ),
            MessageAttributes: {
              failureCode: { DataType: 'String', StringValue: code },
              sourceMessageId: {
                DataType: 'String',
                StringValue: message.MessageId ?? 'unknown',
              },
            },
          }),
        );
        await this.ack(message);
        this.report({
          level: 'warn',
          event: 'message_dead_lettered',
          ...outcome,
          code,
        });
      } else {
        await this.visibility(
          message,
          signal.aborted ? 0 : visibilityBackoff(count),
        );
        this.report({
          level: 'warn',
          event: 'message_retry',
          ...outcome,
          attempt: count,
        });
      }
      return true;
    }
    await this.ack(message);
    this.report({ level: 'info', event: 'message_committed', ...outcome });
    return true;
  }
  private async ack(message: Message): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.urls.transactions,
        ReceiptHandle: message.ReceiptHandle!,
      }),
    );
  }
}
