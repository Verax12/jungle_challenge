import { loadConfig } from '../adapters/config/environment.js';
import { connectDatabase } from '../adapters/persistence/database.js';
import {
  createLocalSqsClient,
  queueUrls,
} from '../adapters/messaging/local-sqs.js';
import { SqsConsumer } from '../adapters/messaging/sqs-consumer.js';
import { SqsEventPublisher } from '../adapters/messaging/sqs-event-publisher.js';
import { MikroOutboxUnitOfWork } from '../adapters/persistence/outbox-unit-of-work.js';
import { PublishOutbox } from '../application/publish-outbox.js';
import { financialRuntime } from '../adapters/runtime/financial-runtime.js';
import { runMessageWorker } from '../adapters/workers/message-worker.js';
import { createFinancialProcessing } from './financial-processing.js';
import { Telemetry } from '../adapters/observability/telemetry.js';
import { Operations } from '../adapters/observability/operations.js';
import { startWorkerServer } from '../adapters/observability/worker-server.js';
const telemetry = new Telemetry();
let operations: Operations | undefined;
let server: ReturnType<typeof startWorkerServer> | undefined;
const controller = new AbortController();
const stop = () => controller.abort();
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
let database: Awaited<ReturnType<typeof connectDatabase>> | undefined;
let client: ReturnType<typeof createLocalSqsClient> | undefined;
try {
  const mode = process.argv[2];
  if (mode !== 'consumer' && mode !== 'publisher')
    throw new Error('Expected consumer or publisher');
  const config = loadConfig(process.env);
  database = await connectDatabase(config.database);
  operations = new Operations(config, telemetry);
  if (!process.argv.includes('--once'))
    server = startWorkerServer(
      operations,
      config.http.host,
      config.metrics.port,
    );
  client = createLocalSqsClient(config.sqs);
  const urls = await queueUrls(client);
  const report = telemetry.report;
  const consumer = new SqsConsumer(
    client,
    urls,
    createFinancialProcessing(database, telemetry),
    report,
  );
  const publisher = new PublishOutbox(
    new MikroOutboxUnitOfWork(database),
    new SqsEventPublisher(client, urls.events),
    financialRuntime,
  );
  const work =
    mode === 'consumer'
      ? () => consumer.once(controller.signal)
      : async () => {
          const result = await telemetry.observe('outbox', {}, () =>
            publisher.once(),
          );
          if (result)
            report({
              level: result.status === 'retry' ? 'warn' : 'info',
              event: 'outbox_attempt',
              ...result,
            });
          if (result?.status === 'retry' && process.argv.includes('--once'))
            throw new Error('Publish scheduled for retry');
          return result !== undefined;
        };
  await runMessageWorker(
    work,
    controller.signal,
    report,
    process.argv.includes('--once'),
  );
} catch {
  console.error(
    JSON.stringify({ level: 'error', event: 'messaging_worker_failed' }),
  );
  process.exitCode = 1;
} finally {
  await server?.stop();
  await operations?.onApplicationShutdown();
  await database?.close(true);
  client?.destroy();
  process.off('SIGTERM', stop);
  process.off('SIGINT', stop);
}
