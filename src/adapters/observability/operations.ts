import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { WagerTransactionStatus } from '../../domain/wager-transaction.js';
import type { AppConfig } from '../config/environment.js';
import { connectDatabase } from '../persistence/database.js';
import {
  createLocalSqsClient,
  queueUrls,
  queueNames,
} from '../messaging/local-sqs.js';
import type { QueueNames } from '../messaging/local-sqs.js';
import type { Telemetry } from './telemetry.js';

export class Operations {
  private database: ReturnType<typeof connectDatabase> | undefined;
  private readonly client;
  private collecting: Promise<string> | undefined;
  constructor(
    private readonly config: AppConfig,
    readonly telemetry: Telemetry,
    private readonly names: QueueNames = queueNames,
  ) {
    this.client = createLocalSqsClient(config.sqs, true);
  }
  private connect() {
    if (!this.database)
      this.database = connectDatabase(this.config.database, true).catch(
        (error: unknown) => {
          this.database = undefined;
          throw error;
        },
      );
    return this.database;
  }
  private async queues() {
    const urls = await queueUrls(this.client, this.names);
    const attributes = await Promise.all(
      Object.values(urls).map((QueueUrl) =>
        this.client.send(
          new GetQueueAttributesCommand({
            QueueUrl,
            AttributeNames: [
              'ApproximateNumberOfMessages',
              'ApproximateNumberOfMessagesNotVisible',
              'ApproximateNumberOfMessagesDelayed',
            ],
          }),
        ),
      ),
    );
    return attributes[1]!.Attributes!;
  }
  async ready() {
    const results = await Promise.allSettled([
      this.connect().then((db) => db.em.getConnection().execute('select 1')),
      this.queues(),
    ]);
    const checks = {
      postgres: results[0].status === 'fulfilled' ? 'up' : 'down',
      sqs: results[1].status === 'fulfilled' ? 'up' : 'down',
    };
    return {
      status:
        checks.postgres === 'up' && checks.sqs === 'up'
          ? 'ready'
          : 'unavailable',
      checks,
    };
  }
  metrics(): Promise<string> {
    if (!this.collecting)
      this.collecting = this.collect().finally(() => {
        this.collecting = undefined;
      });
    return this.collecting;
  }
  private async collect() {
    const [db, attrs] = await Promise.all([this.connect(), this.queues()]);
    const [snapshot] = await db.em
      .getConnection()
      .execute<
        { pending: string; lag: string; statuses: Record<string, string> }[]
      >(
        `select count(*)::text as pending, coalesce(greatest(0,extract(epoch from (clock_timestamp()-min(occurred_at)))),0)::text as lag,
       (select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) from (select status,count(*)::text n from wager_transactions group by status) s) as statuses
       from outbox_messages where published_at is null`,
      );
    if (!snapshot) throw new Error('Metrics snapshot unavailable');
    this.telemetry.outboxPending.set(Number(snapshot.pending));
    this.telemetry.outboxLag.set(Number(snapshot.lag));
    for (const status of Object.values(WagerTransactionStatus))
      this.telemetry.transactions.set(
        { status },
        Number(snapshot.statuses[status] ?? 0),
      );
    for (const [state, key] of [
      ['visible', 'ApproximateNumberOfMessages'],
      ['inflight', 'ApproximateNumberOfMessagesNotVisible'],
      ['delayed', 'ApproximateNumberOfMessagesDelayed'],
    ] as const) {
      if (attrs[key] === undefined)
        throw new Error('Queue metrics unavailable');
      this.telemetry.dlqDepth.set({ state }, Number(attrs[key]));
    }
    return this.telemetry.registry.metrics();
  }
  async onApplicationShutdown() {
    await this.collecting?.catch(() => {});
    await (await this.database?.catch(() => undefined))?.close(true);
    this.client.destroy();
  }
}
