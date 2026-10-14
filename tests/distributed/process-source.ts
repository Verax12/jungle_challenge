export const processSource = `
import { loadConfig } from './dist/adapters/config/environment.js';
import { connectDatabase } from './dist/adapters/persistence/database.js';
import { createFinancialProcessing } from './dist/composition/financial-processing.js';
import { FinancialProcessing } from './dist/application/financial-processing.js';
import { MikroFinancialSession } from './dist/adapters/persistence/financial-unit-of-work.js';
import { MikroFinancialQueries } from './dist/adapters/persistence/financial-queries.js';
import { createApplication } from './dist/composition/bootstrap.js';
import { createLocalSqsClient } from './dist/adapters/messaging/local-sqs.js';
import { SqsConsumer } from './dist/adapters/messaging/sqs-consumer.js';
import { ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { PublishOutbox } from './dist/application/publish-outbox.js';
import { MikroOutboxSession } from './dist/adapters/persistence/outbox-unit-of-work.js';
import { SqsEventPublisher } from './dist/adapters/messaging/sqs-event-publisher.js';
import { financialRuntime } from './dist/adapters/runtime/financial-runtime.js';
import { runMessageWorker } from './dist/adapters/workers/message-worker.js';
import { runReferenceWorker } from './dist/adapters/workers/reference-worker.js';
const mode = process.env.TASK_PROCESS_MODE,
  gatePoint = process.env.TASK_GATE;
const emit = (data) => process.send({ ...data, pid: process.pid });
const stop = new AbortController();
let begin, release;
const started = new Promise((resolve) => (begin = resolve));
const gate = new Promise((resolve) => (release = resolve));
process.on('message', (message) => {
  if (message === 'start') setImmediate(begin);
  if (message === 'release') setImmediate(release);
});
const shutdown = () => {
  stop.abort();
  begin();
  release();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
let orm,
  client,
  app,
  held = false,
  receipt,
  dbPid;
async function barrier(point, details = {}) {
  if (gatePoint === point && !held) {
    held = true;
    emit({ event: 'barrier', point, ...details });
    await gate;
  }
}
try {
  orm = await connectDatabase(loadConfig(process.env).database);
  client = createLocalSqsClient(loadConfig(process.env).sqs);
  const urls = JSON.parse(process.env.TASK_QUEUE_URLS);
  [{ pid: dbPid }] = await orm.em
    .getConnection()
    .execute('select pg_backend_pid() as pid');
  let processing = createFinancialProcessing(orm);
  if (gatePoint === 'before-commit')
    processing = new FinancialProcessing(
      {
        run: (work) =>
          orm.em.fork().transactional(async (em) => {
            const result = await work(new MikroFinancialSession(em));
            await em.flush();
            await barrier('before-commit', { receipt });
            return result;
          }),
      },
      financialRuntime,
    );
  if (mode === 'api') {
    app = await createApplication(true, {
      processing,
      queries: new MikroFinancialQueries(orm),
    });
    await app.listen(0, '127.0.0.1');
    emit({ event: 'ready', mode, url: await app.getUrl(), dbPid });
    await new Promise((resolve) =>
      stop.signal.addEventListener('abort', resolve, { once: true }),
    );
  } else {
    emit({ event: 'ready', mode, dbPid });
    await started;
    emit({ event: 'started', mode });
    if (mode === 'consumer') {
      const base = client.send.bind(client);
      client.send = async (command, options) => {
        const result = await base(command, options);
        if (command instanceof ReceiveMessageCommand)
          receipt = result.Messages?.[0]?.ReceiptHandle;
        return result;
      };
      const worker = new SqsConsumer(
        client,
        urls,
        {
          process: async (...args) => {
            await barrier('before-process', { receipt });
            const result = await processing.process(...args);
            await barrier('after-commit', {
              receipt,
              transactionId: result.transactionId,
            });
            return result;
          },
        },
        emit,
      );
      await runMessageWorker(() => worker.once(stop.signal), stop.signal, emit);
    } else if (mode === 'publisher') {
      const sink = new SqsEventPublisher(client, urls.events);
      const worker = new PublishOutbox(
        {
          run: (work) =>
            orm.em.fork().transactional(async (em) => {
              [{ pid: dbPid }] = await em
                .getConnection()
                .execute(
                  'select pg_backend_pid() as pid',
                  [],
                  'all',
                  em.getTransactionContext(),
                );
              return work(new MikroOutboxSession(em));
            }),
        },
        {
          publish: async (message) => {
            await barrier('before-publish', { eventId: message.id, dbPid });
            await sink.publish(message);
            await barrier('after-send', { eventId: message.id, dbPid });
          },
        },
        financialRuntime,
      );
      await runMessageWorker(
        async () => {
          const result = await worker.once();
          if (result) emit({ event: 'published', ...result });
          return result !== undefined;
        },
        stop.signal,
        emit,
      );
    } else if (mode === 'references') {
      await runReferenceWorker(
        () => processing.retryReference(),
        stop.signal,
        emit,
      );
    } else throw new Error('Unknown test process mode');
  }
} catch (error) {
  emit({ event: 'fatal', code: error?.code ?? error?.name ?? 'ERROR' });
  process.exitCode = 1;
} finally {
  await app?.close();
  await orm?.close(true);
  client?.destroy();
  process.off('SIGTERM', shutdown);
  process.off('SIGINT', shutdown);
  process.disconnect();
}
`;
