import { IsolationLevel, LockMode } from '@mikro-orm/core';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type {
  OutboxSession,
  OutboxUnitOfWork,
} from '../../application/ports/outbox-store.js';
import type { OutboxMessage } from '../../domain/messages.js';
import { OutboxEntity } from './entities.js';
import type { OutboxRecord } from './entities.js';
import { outboxMapper } from './mappers.js';

export class MikroOutboxSession implements OutboxSession {
  private claimed: OutboxRecord | undefined;
  constructor(private readonly em: EntityManager) {}
  async claim(now: string) {
    const row = await this.em.findOne(
      OutboxEntity,
      {
        publishedAt: null,
        occurredAt: { $lte: new Date(now) },
        $or: [
          { nextAttemptAt: null },
          { nextAttemptAt: { $lte: new Date(now) } },
        ],
      },
      {
        orderBy: { occurredAt: 'asc', id: 'asc' },
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
        refresh: true,
      },
    );
    if (!row) return undefined;
    this.claimed = row;
    return outboxMapper.toDomain(row);
  }
  save(message: OutboxMessage): void {
    if (!this.claimed || this.claimed.id !== message.id)
      throw new Error('Outbox message must be claimed');
    this.em.assign(this.claimed, outboxMapper.toRecord(message));
  }
}
export class MikroOutboxUnitOfWork implements OutboxUnitOfWork {
  constructor(private readonly orm: MikroORM) {}
  run<T>(work: (session: OutboxSession) => Promise<T>): Promise<T> {
    return this.orm.em
      .fork({ useContext: false })
      .transactional((em) => work(new MikroOutboxSession(em)), {
        isolationLevel: IsolationLevel.READ_COMMITTED,
      });
  }
}
