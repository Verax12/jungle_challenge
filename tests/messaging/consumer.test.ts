import { beforeEach, afterEach, expect, test } from 'bun:test';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { fixture, open, message, send, receive } from './helpers.js';
import {
  InboxEntity,
  LedgerEntity,
  WalletEntity,
  ReceiptEntity,
  TransactionEntity,
  OutboxEntity,
  ReferenceJobEntity,
} from '../../src/adapters/persistence/entities.js';
import { SqsConsumer } from '../../src/adapters/messaging/sqs-consumer.js';
import { FinancialProcessing } from '../../src/application/financial-processing.js';
import { MikroFinancialSession } from '../../src/adapters/persistence/financial-unit-of-work.js';
import { financialRuntime } from '../../src/adapters/runtime/financial-runtime.js';
import {
  parseWagerMessage,
  consumerName,
} from '../../src/adapters/messaging/request-contract.js';
import { sql, unique } from '../persistence/helpers.js';
let f: Awaited<ReturnType<typeof fixture>>;
const signal = () => new AbortController().signal;
beforeEach(async () => {
  f = await fixture();
});
afterEach(async () => {
  await f?.close();
});
async function balance(id: string, amount: string) {
  expect(
    (await f.orm.em.fork().findOneOrFail(WalletEntity, { id })).balance,
  ).toBe(amount);
}

test('consume persists inbox and financial effects before ack, replay survives new SQS delivery', async () => {
  const w = await open(f),
    body = message(w);
  await send(f.client, f.urls.transactions, body);
  const base = f.client.send.bind(f.client);
  let acked = false;
  f.client.send = (async (command: unknown) => {
    if (command instanceof DeleteMessageCommand) {
      const inbox = await f.orm.em.fork().findOneOrFail(InboxEntity, {
        consumerName,
        messageId: body.messageId,
      });
      expect(inbox.processedAt).not.toBeNull();
      await balance(w.id, '75.00');
      acked = true;
    }
    return base(command as never);
  }) as typeof f.client.send;
  expect(await f.consumer.once(signal())).toBe(true);
  expect(acked).toBe(true);
  await send(f.client, f.urls.transactions, body);
  await f.consumer.once(signal());
  const em = f.orm.em.fork();
  expect(await em.count(InboxEntity, {})).toBe(1);
  expect(await em.count(ReceiptEntity, {})).toBe(1);
  expect(await em.count(LedgerEntity, { walletId: w.id })).toBe(2);
  expect(await em.count(OutboxEntity, {})).toBe(4);
  expect(f.logs.at(-1)).toMatchObject({
    event: 'message_committed',
    idempotentReplay: true,
  });
  expect(await receive(f.client, f.urls.transactions)).toBeUndefined();
});

test('same operation via HTTP use case then SQS commits a new inbox without another debit', async () => {
  const w = await open(f),
    body = message(w),
    p = parseWagerMessage(JSON.stringify(body));
  await f.service.process(p.command, p.context);
  await send(f.client, f.urls.transactions, body);
  await f.consumer.once(signal());
  await balance(w.id, '75.00');
  expect(await f.orm.em.fork().count(InboxEntity, {})).toBe(1);
  expect(f.logs.at(-1)).toMatchObject({ idempotentReplay: true });
});

test.each(['REJECTED', 'PENDING_REFERENCE'])(
  'business %s commits inbox and acknowledges without DLQ',
  async (status) => {
    const w = await open(f),
      body = message(
        w,
        status === 'REJECTED'
          ? { money: { amount: '200.00', currency: 'BRL' } }
          : { kind: 'REFUND', referenceExternalTransactionId: unique() },
      );
    await send(f.client, f.urls.transactions, body);
    await f.consumer.once(signal());
    expect(f.logs.at(-1)).toMatchObject({ status, event: 'message_committed' });
    expect(await f.orm.em.fork().count(InboxEntity, {})).toBe(1);
    expect(await receive(f.client, f.urls.deadLetters)).toBeUndefined();
    await balance(w.id, '100.00');
    if (status === 'PENDING_REFERENCE')
      expect(await f.orm.em.fork().count(ReferenceJobEntity, {})).toBe(1);
  },
);

test.each([
  'invalid-json',
  'OPENING',
  'money-number',
  'missing-key',
  'unknown-type',
])('permanent %s is moved to DLQ before source ack', async (fault) => {
  const w = await open(f);
  const body: Record<string, unknown> = message(w);
  const data = body.data as Record<string, unknown>;
  if (fault === 'OPENING') data.kind = 'OPENING';
  if (fault === 'money-number') data.money = { amount: 25, currency: 'BRL' };
  if (fault === 'missing-key') delete data.idempotencyKey;
  if (fault === 'unknown-type') body.type = 'Other';
  await send(
    f.client,
    f.urls.transactions,
    fault === 'invalid-json' ? '{invalid' : body,
  );
  await f.consumer.once(signal());
  const dead = await receive(f.client, f.urls.deadLetters);
  expect(dead).toBeDefined();
  expect(dead!.MessageAttributes?.failureCode?.StringValue).toBeString();
  expect(await receive(f.client, f.urls.transactions)).toBeUndefined();
  expect(await f.orm.em.fork().count(InboxEntity, {})).toBe(0);
  await balance(w.id, '100.00');
});

test('reused logical message ID with a changed payload goes to DLQ and preserves original inbox', async () => {
  const w = await open(f),
    body = message(w);
  await send(f.client, f.urls.transactions, body);
  await f.consumer.once(signal());
  const first = await f.orm.em
    .fork()
    .findOneOrFail(InboxEntity, { consumerName, messageId: body.messageId });
  body.data.money.amount = '30.00';
  await send(f.client, f.urls.transactions, body);
  await f.consumer.once(signal());
  expect(
    (await receive(f.client, f.urls.deadLetters))!.MessageAttributes
      ?.failureCode?.StringValue,
  ).toBe('IDEMPOTENCY_CONFLICT');
  expect(
    (
      await f.orm.em
        .fork()
        .findOneOrFail(InboxEntity, { consumerName, messageId: body.messageId })
    ).payloadHash,
  ).toBe(first.payloadHash);
  await balance(w.id, '75.00');
});

test('two consumers on different FIFO groups race on the same inbox with a single effect', async () => {
  const w = await open(f),
    body = message(w);
  await send(f.client, f.urls.transactions, body);
  await send(f.client, f.urls.transactions, body);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const pids = new Set<number>();
  const processing = new FinancialProcessing(
    {
      run: (work) =>
        f.orm.em.fork().transactional(async (em) => {
          const [{ pid }] = (await sql(
            em,
            'select pg_backend_pid() as pid',
          )) as [{ pid: number }];
          pids.add(pid);
          if (pids.size === 2) release();
          await gate;
          return work(new MikroFinancialSession(em));
        }),
    },
    financialRuntime,
  );
  const make = () =>
    new SqsConsumer(f.client, f.urls, processing, (e) => f.logs.push(e));
  await Promise.all([make().once(signal()), make().once(signal())]);
  expect(pids.size).toBe(2);
  expect(await f.orm.em.fork().count(InboxEntity, {})).toBe(1);
  expect(await f.orm.em.fork().count(LedgerEntity, { walletId: w.id })).toBe(2);
  await balance(w.id, '75.00');
});

test('failure after SQL flush rolls back inbox, receipt, ledger and events, and source is not acked', async () => {
  const w = await open(f),
    body = message(w);
  await send(f.client, f.urls.transactions, body);
  const broken = new FinancialProcessing(
    {
      run: (work) =>
        f.orm.em.fork().transactional(async (em) => {
          await work(new MikroFinancialSession(em));
          await em.flush();
          throw Object.assign(new Error('injected disconnect'), {
            code: '08006',
          });
        }),
    },
    financialRuntime,
  );
  const worker = new SqsConsumer(f.client, f.urls, broken, (e) =>
    f.logs.push(e),
  );
  await worker.once(signal());
  const em = f.orm.em.fork();
  expect(await em.count(InboxEntity, {})).toBe(0);
  expect(await em.count(ReceiptEntity, {})).toBe(0);
  expect(await em.count(TransactionEntity, {})).toBe(1);
  expect(await em.count(OutboxEntity, {})).toBe(2);
  await balance(w.id, '100.00');
  expect(f.logs.at(-1)).toMatchObject({ event: 'message_retry', attempt: 1 });
  expect(await receive(f.client, f.urls.transactions)).toBeUndefined();
  await Bun.sleep(1100);
  await f.consumer.once(signal());
  await balance(w.id, '75.00');
});

test('five transient receives use exponential visibility then DLQ; broker redrive is configured', async () => {
  const w = await open(f);
  await send(f.client, f.urls.transactions, message(w));
  const { Attributes } = await f.client.send(
    new GetQueueAttributesCommand({
      QueueUrl: f.urls.transactions,
      AttributeNames: ['RedrivePolicy'],
    }),
  );
  expect(JSON.parse(Attributes!.RedrivePolicy!)).toMatchObject({
    maxReceiveCount: 5,
  });
  const backoffs: number[] = [];
  const base = f.client.send.bind(f.client);
  f.client.send = (async (command: unknown) => {
    if (command instanceof ChangeMessageVisibilityCommand) {
      backoffs.push(command.input.VisibilityTimeout!);
      const result = await base(command);
      await base(
        new ChangeMessageVisibilityCommand({
          ...command.input,
          VisibilityTimeout: 0,
        }),
      );
      return result;
    }
    return base(command as never);
  }) as typeof f.client.send;
  const broken = {
    process: async () => {
      throw Object.assign(new Error('database unavailable'), { code: '08006' });
    },
  };
  const worker = new SqsConsumer(f.client, f.urls, broken, (e) =>
    f.logs.push(e),
  );
  for (let i = 0; i < 5; i++) await worker.once(signal());
  expect(backoffs).toEqual([1, 2, 4, 8]);
  const dead = await receive(f.client, f.urls.deadLetters);
  expect(dead!.MessageAttributes?.failureCode?.StringValue).toBe(
    'RETRIES_EXHAUSTED',
  );
  expect(await f.orm.em.fork().count(InboxEntity, {})).toBe(0);
  await balance(w.id, '100.00');
});

test('failure to send DLQ does not delete the source message', async () => {
  await send(f.client, f.urls.transactions, '{bad');
  const urls = { ...f.urls, deadLetters: f.urls.deadLetters + '-missing' };
  const worker = new SqsConsumer(f.client, urls, f.service, () => {});
  await expect(worker.once(signal())).rejects.toThrow();
  const attrs = await f.client.send(
    new GetQueueAttributesCommand({
      QueueUrl: f.urls.transactions,
      AttributeNames: ['ApproximateNumberOfMessagesNotVisible'],
    }),
  );
  expect(attrs.Attributes?.ApproximateNumberOfMessagesNotVisible).toBe('1');
});

test('shutdown after receive returns visibility without starting financial work', async () => {
  const w = await open(f);
  await send(f.client, f.urls.transactions, message(w));
  const stop = new AbortController();
  const base = f.client.send.bind(f.client);
  f.client.send = (async (command: unknown, options?: unknown) => {
    const result = await base(command as never, options as never);
    if (command instanceof ReceiveMessageCommand) stop.abort();
    return result;
  }) as typeof f.client.send;
  expect(await f.consumer.once(stop.signal)).toBe(false);
  expect(await receive(f.client, f.urls.transactions)).toBeDefined();
  await balance(w.id, '100.00');
});

test('broker redrive moves an unacknowledged message after five receives even without consumer DLQ code', async () => {
  const w = await open(f);
  await send(f.client, f.urls.transactions, message(w));
  for (let attempt = 1; attempt <= 5; attempt++) {
    const item = await receive(f.client, f.urls.transactions);
    expect(Number(item!.Attributes?.ApproximateReceiveCount)).toBe(attempt);
    await f.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: f.urls.transactions,
        ReceiptHandle: item!.ReceiptHandle!,
        VisibilityTimeout: 0,
      }),
    );
  }
  expect(await receive(f.client, f.urls.transactions)).toBeUndefined();
  expect(await receive(f.client, f.urls.deadLetters)).toBeDefined();
  await balance(w.id, '100.00');
});

test('in-flight processing renews visibility and then commits before ack', async () => {
  const w = await open(f);
  await send(f.client, f.urls.transactions, message(w));
  let renewed!: () => void;
  const gate = new Promise<void>((resolve) => {
    renewed = resolve;
  });
  const base = f.client.send.bind(f.client);
  let renewals = 0;
  f.client.send = (async (command: unknown) => {
    const result = await base(command as never);
    if (
      command instanceof ChangeMessageVisibilityCommand &&
      command.input.VisibilityTimeout === 30
    ) {
      renewals++;
      renewed();
    }
    return result;
  }) as typeof f.client.send;
  const worker = new SqsConsumer(
    f.client,
    f.urls,
    {
      process: async (...args) => {
        await gate;
        return f.service.process(...args);
      },
    },
    (event) => f.logs.push(event),
  );
  await worker.once(signal());
  expect(renewals).toBe(1);
  expect(await receive(f.client, f.urls.transactions)).toBeUndefined();
  await balance(w.id, '75.00');
});
