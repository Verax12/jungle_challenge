import type { OutboxMessage } from '../../domain/messages.js';
export interface OutboxSession {
  claim(now: string): Promise<OutboxMessage | undefined>;
  save(message: OutboxMessage): void;
}
export interface OutboxUnitOfWork {
  run<T>(work: (session: OutboxSession) => Promise<T>): Promise<T>;
}
export interface EventPublisher {
  publish(message: OutboxMessage): Promise<void>;
}
