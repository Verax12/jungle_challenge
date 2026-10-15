import { Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';
import { WagerTransactionStatus } from '../../domain/wager-transaction.js';

export type Source = 'http' | 'sqs' | 'reference' | 'outbox';
const fields = [
  'correlationId',
  'messageId',
  'transactionId',
  'walletId',
  'providerId',
  'sqsMessageId',
  'eventId',
  'status',
  'code',
  'attempt',
  'attempts',
  'idempotentReplay',
  'consistent',
  'durationSeconds',
] as const;
const statuses = Object.values(WagerTransactionStatus);
export class Telemetry {
  readonly registry = new Registry();
  private counter(name: string, help: string, labelNames: string[] = []) {
    return new Counter({
      name: `wagering_${name}`,
      help,
      labelNames,
      registers: [this.registry],
    });
  }
  readonly outcomes = this.counter(
    'processing_results_total',
    'Committed non-replay outcomes observed by this process.',
    ['source', 'status'],
  );
  readonly duplicates = this.counter(
    'duplicates_total',
    'Durable financial replays observed by this process.',
    ['source'],
  );
  readonly retries = this.counter(
    'retries_total',
    'Retries scheduled or attempted by this process.',
    ['source'],
  );
  readonly deadLetters = this.counter(
    'dead_letters_total',
    'Explicit DLQ sends confirmed by this process.',
  );
  readonly locks = this.counter(
    'lock_conflicts_total',
    'Lock timeouts, deadlocks or serialization failures observed.',
    ['source', 'code'],
  );
  readonly reconciliations = this.counter(
    'reconciliations_total',
    'Completed reconciliations.',
    ['consistent'],
  );
  readonly latency = new Histogram({
    name: 'wagering_processing_duration_seconds',
    help: 'Processing attempts including failed attempts, through SQL commit.',
    labelNames: ['source'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [this.registry],
  });
  readonly transactions = new Gauge({
    name: 'wagering_transactions',
    help: 'Current persisted transactions by status, including OPENING.',
    labelNames: ['status'],
    registers: [this.registry],
  });
  readonly outboxPending = new Gauge({
    name: 'wagering_outbox_pending',
    help: 'Current unpublished persisted outbox rows.',
    registers: [this.registry],
  });
  readonly outboxLag = new Gauge({
    name: 'wagering_outbox_lag_seconds',
    help: 'Age of the oldest unpublished event; zero when empty.',
    registers: [this.registry],
  });
  readonly dlqDepth = new Gauge({
    name: 'wagering_dlq_messages',
    help: 'Approximate messages in DLQ, including native redrive.',
    labelNames: ['state'],
    registers: [this.registry],
  });
  constructor(private readonly sink: (line: string) => void = console.log) {
    for (const source of ['http', 'sqs', 'reference', 'outbox']) {
      this.retries.inc({ source }, 0);
      for (const code of ['55P03', '40P01', '40001'])
        this.locks.inc({ source, code }, 0);
    }
    for (const source of ['http', 'sqs']) {
      this.duplicates.inc({ source }, 0);
      for (const status of statuses) this.outcomes.inc({ source, status }, 0);
    }
    this.deadLetters.inc(0);
    for (const consistent of ['true', 'false'])
      this.reconciliations.inc({ consistent }, 0);
  }
  readonly report = (input: Record<string, unknown>): void => {
    try {
      if (input.event === 'message_retry') this.retries.inc({ source: 'sqs' });
      if (input.event === 'message_dead_lettered') this.deadLetters.inc();
      if (input.event === 'outbox_attempt' && input.status === 'retry')
        this.retries.inc({ source: 'outbox' });
      if (input.event === 'reference_attempt')
        this.retries.inc({ source: 'reference' });
      const output: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        level:
          input.level === 'error'
            ? 'error'
            : input.level === 'warn'
              ? 'warn'
              : 'info',
        event: input.event,
        correlationId: null,
        messageId: null,
        transactionId: null,
        walletId: null,
        providerId: null,
      };
      for (const key of fields) {
        const value = input[key];
        if (typeof value === 'string') output[key] = value.slice(0, 256);
        else if (
          typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value))
        )
          output[key] = value;
      }
      this.sink(JSON.stringify(output));
    } catch {
      /* Logging must not change a committed financial outcome. */
    }
  };
  failure(
    source: Source,
    error: unknown,
    context: Record<string, unknown> = {},
  ) {
    const driver = error as {
      code?: unknown;
      cause?: { code?: unknown };
    } | null;
    const code = driver?.code ?? driver?.cause?.code;
    const lock =
      typeof code === 'string' && ['55P03', '40P01', '40001'].includes(code);
    if (lock) this.locks.inc({ source, code });
    this.report({
      level: 'error',
      event: 'processing_failed',
      ...context,
      code: lock ? code : 'PROCESSING_FAILED',
    });
  }
  async observe<T>(
    source: Source,
    context: Record<string, unknown>,
    work: () => Promise<T>,
  ): Promise<T> {
    const start = performance.now();
    let measured = true;
    try {
      const result = await work();
      measured = result !== undefined;
      return result;
    } catch (error) {
      this.failure(source, error, context);
      throw error;
    } finally {
      if (measured)
        this.latency.observe({ source }, (performance.now() - start) / 1000);
    }
  }
  outcome(
    source: Source,
    result: { status: string; idempotentReplay?: boolean },
  ) {
    if (result.idempotentReplay) this.duplicates.inc({ source });
    else if (statuses.includes(result.status as (typeof statuses)[number]))
      this.outcomes.inc({ source, status: result.status });
  }
}
