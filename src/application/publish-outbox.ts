import type { OutboxUnitOfWork, EventPublisher } from './ports/outbox-store.js';
import type { FinancialRuntime } from './ports/financial-store.js';

export class PublishOutbox {
  constructor(
    private readonly unit: OutboxUnitOfWork,
    private readonly publisher: EventPublisher,
    private readonly runtime: FinancialRuntime,
  ) {}
  async once() {
    return this.unit.run(async (session) => {
      const message = await session.claim(this.runtime.now());
      if (!message) return undefined;
      let published = false;
      try {
        await this.publisher.publish(message);
        published = true;
      } catch {
        message.scheduleRetry(
          [this.runtime.now(), message.occurredAt].sort().at(-1)!,
          { baseDelayMs: 1000, maxDelayMs: 60000 },
        );
      }
      if (published)
        message.markPublished(
          [this.runtime.now(), message.occurredAt].sort().at(-1)!,
        );
      session.save(message);
      const payload = message.payload as {
        correlationId?: string;
        causationId?: string;
        data?: {
          walletId?: string;
          transactionId?: string;
          providerId?: string;
        };
      };
      return {
        correlationId: payload.correlationId,
        messageId: payload.causationId,
        walletId: payload.data?.walletId,
        transactionId: payload.data?.transactionId,
        providerId: payload.data?.providerId,
        eventId: message.id,
        status: published ? 'published' : 'retry',
        attempts: message.attempts,
      };
    });
  }
}
