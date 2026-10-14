import { loadConfig } from '../adapters/config/environment.js';
import { connectDatabase } from '../adapters/persistence/database.js';
import { runReferenceWorker } from '../adapters/workers/reference-worker.js';
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
try {
  const config = loadConfig(process.env);
  database = await connectDatabase(config.database);
  operations = new Operations(config, telemetry);
  if (!process.argv.includes('--once'))
    server = startWorkerServer(
      operations,
      config.http.host,
      config.metrics.port,
    );
  const service = createFinancialProcessing(database, telemetry);
  await runReferenceWorker(
    () => service.retryReference(),
    controller.signal,
    telemetry.report,
    process.argv.includes('--once'),
  );
} catch {
  console.error(
    JSON.stringify({ level: 'error', event: 'reference_worker_failed' }),
  );
  process.exitCode = 1;
} finally {
  await server?.stop();
  await operations?.onApplicationShutdown();
  await database?.close(true);
  process.off('SIGTERM', stop);
  process.off('SIGINT', stop);
}
