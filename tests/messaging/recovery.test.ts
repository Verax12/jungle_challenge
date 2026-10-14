import { beforeEach, afterEach, expect, test } from 'bun:test';
import { ChangeMessageVisibilityCommand } from '@aws-sdk/client-sqs';
import {
  fixture,
  open,
  message,
  send,
  receive,
  publishAll,
  drain,
} from './helpers.js';
import { loadConfig } from '../../src/adapters/config/environment.js';
import {
  InboxEntity,
  WalletEntity,
  LedgerEntity,
  OutboxEntity,
} from '../../src/adapters/persistence/entities.js';
import { consumerName } from '../../src/adapters/messaging/request-contract.js';
import { sql } from '../persistence/helpers.js';
import { InboxMessage } from '../../src/domain/messages.js';
import { MikroFinancialSession } from '../../src/adapters/persistence/financial-unit-of-work.js';
import { financialRuntime } from '../../src/adapters/runtime/financial-runtime.js';
let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
});
afterEach(async () => {
  await f?.close();
});
function spawn(code: string) {
  const config = loadConfig(process.env).database;
  return Bun.spawn(
    [
      process.execPath,
      '--eval',
      `
    import {loadConfig} from './dist/adapters/config/environment.js';
    import {connectDatabase} from './dist/adapters/persistence/database.js';
    import {createLocalSqsClient} from './dist/adapters/messaging/local-sqs.js';
    const config=loadConfig(process.env);
    const orm=await connectDatabase(config.database),client=createLocalSqsClient(config.sqs);
    const urls=JSON.parse(process.env.TASK_QUEUE_URLS);
    ${code}
  `,
    ],
    {
      env: {
        ...process.env,
        DB_NAME: f.name,
        DB_HOST: config.host,
        DB_PORT: String(config.port),
        DB_USER: config.user,
        DB_PASSWORD: config.password,
        TASK_QUEUE_URLS: JSON.stringify(f.urls),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
}
async function marker(child: ReturnType<typeof spawn>) {
  const reader = child.stdout.getReader();
  try {
    const data = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('child did not reach barrier')),
          8000,
        ).unref(),
      ),
    ]);
    if (!data.value)
      throw new Error(
        `child exited: ${await new Response(child.stderr).text()}`,
      );
    return JSON.parse(
      new TextDecoder().decode(data.value).trim().split('\n')[0]!,
    ) as { receipt: string; eventId: string };
  } finally {
    reader.releaseLock();
  }
}
const consumerCode = `
  import {SqsConsumer} from './dist/adapters/messaging/sqs-consumer.js';
  import {ReceiveMessageCommand} from '@aws-sdk/client-sqs';
  import {createFinancialProcessing} from './dist/composition/financial-processing.js';
  const controller=new AbortController();process.on('SIGTERM',()=>controller.abort());
  let receipt;const base=client.send.bind(client);client.send=async(command,options)=>{
    const result=await base(command,options);if(command instanceof ReceiveMessageCommand)receipt=result.Messages?.[0]?.ReceiptHandle;return result;
  };
  const service=createFinancialProcessing(orm);
  const worker=new SqsConsumer(client,urls,{process:async(...args)=>{
    const result=await service.process(...args);console.log(JSON.stringify({receipt}));
    await new Promise(resolve=>controller.signal.addEventListener('abort',resolve,{once:true}));return result;
  }},()=>{});
  await worker.once(controller.signal);await orm.close(true);client.destroy();
`;

test('SIGKILL after financial commit before ack redelivers to another consumer without duplicate debit', async () => {
  const w = await open(f),
    body = message(w);
  await send(f.client, f.urls.transactions, body);
  const child = spawn(consumerCode);
  let receipt = '';
  try {
    receipt = (await marker(child)).receipt;
    expect(receipt).toBeString();
  } finally {
    child.kill('SIGKILL');
    await child.exited;
  }
  expect(
    (
      await f.orm.em
        .fork()
        .findOneOrFail(InboxEntity, { consumerName, messageId: body.messageId })
    ).processedAt,
  ).not.toBeNull();
  await f.client.send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: f.urls.transactions,
      ReceiptHandle: receipt,
      VisibilityTimeout: 0,
    }),
  );
  await f.consumer.once(new AbortController().signal);
  expect(f.logs.at(-1)).toMatchObject({ idempotentReplay: true });
  expect(
    (await f.orm.em.fork().findOneOrFail(WalletEntity, { id: w.id })).balance,
  ).toBe('75.00');
  expect(await f.orm.em.fork().count(LedgerEntity, { walletId: w.id })).toBe(2);
  await publishAll(f);
  expect(await drain(f.client, f.urls.events)).toHaveLength(4);
});

test('SIGTERM during in-flight processing completes committed message and ack before exiting', async () => {
  const w = await open(f);
  await send(f.client, f.urls.transactions, message(w));
  const child = spawn(consumerCode);
  try {
    await marker(child);
    child.kill('SIGTERM');
    expect(await child.exited).toBe(0);
  } finally {
    child.kill('SIGKILL');
    await child.exited;
  }
  expect(await receive(f.client, f.urls.transactions)).toBeUndefined();
  expect(
    (await f.orm.em.fork().findOneOrFail(WalletEntity, { id: w.id })).balance,
  ).toBe('75.00');
});

test('publisher process killed after broker acceptance releases row and another publisher completes', async () => {
  await open(f);
  const child = spawn(`
    import {PublishOutbox} from './dist/application/publish-outbox.js';
    import {MikroOutboxUnitOfWork} from './dist/adapters/persistence/outbox-unit-of-work.js';
    import {SqsEventPublisher} from './dist/adapters/messaging/sqs-event-publisher.js';
    import {financialRuntime} from './dist/adapters/runtime/financial-runtime.js';
    const sink=new SqsEventPublisher(client,urls.events);
    const publisher=new PublishOutbox(new MikroOutboxUnitOfWork(orm),{publish:async message=>{
      await sink.publish(message);console.log(JSON.stringify({eventId:message.id}));await new Promise(()=>setInterval(()=>{},1000));
    }},financialRuntime);
    await publisher.once();
  `);
  let id = '';
  try {
    id = (await marker(child)).eventId;
    expect(id).toBeString();
  } finally {
    child.kill('SIGKILL');
    await child.exited;
  }
  expect(
    (await f.orm.em.fork().findOneOrFail(OutboxEntity, { id })).publishedAt,
  ).toBeNull();
  await publishAll(f);
  expect(
    (await f.orm.em.fork().findOneOrFail(OutboxEntity, { id })).publishedAt,
  ).not.toBeNull();
  const events = (await drain(f.client, f.urls.events)).map(
    (m) => JSON.parse(m.Body!).eventId,
  );
  expect(events).toHaveLength(2);
  expect(new Set(events).size).toBe(2);
});

test('downstream inbox contract deduplicates repeated eventId even when broker dedup is bypassed', async () => {
  await open(f);
  await publishAll(f);
  const original = (await drain(f.client, f.urls.events))[0]!;
  await send(f.client, f.urls.events, original.Body!);
  await send(f.client, f.urls.events, original.Body!);
  const copies = await drain(f.client, f.urls.events);
  expect(copies).toHaveLength(2);
  await sql(
    f.orm.em.fork(),
    'create table test_event_effects (event_id text primary key)',
  );
  for (const item of copies) {
    const event = JSON.parse(item.Body!);
    await f.orm.em.fork().transactional(async (em) => {
      const session = new MikroFinancialSession(em);
      const requested = InboxMessage.receive({
        consumerName: 'test-event-subscriber',
        messageId: event.eventId,
        payloadHash: financialRuntime.hash(item.Body!),
        receivedAt: financialRuntime.now(),
      });
      const stored = await session.receiveInbox(requested);
      stored.assertPayload(requested.payloadHash);
      if (!stored.isProcessed()) {
        stored.markProcessed(financialRuntime.now());
        session.completeInbox(stored);
        await sql(em, 'insert into test_event_effects values (?)', [
          event.eventId,
        ]);
      }
    });
  }
  expect(
    await sql(f.orm.em.fork(), 'select * from test_event_effects'),
  ).toHaveLength(1);
  expect(
    await f.orm.em
      .fork()
      .count(InboxEntity, { consumerName: 'test-event-subscriber' }),
  ).toBe(1);
});
