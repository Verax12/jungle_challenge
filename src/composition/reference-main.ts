import { loadConfig } from '../adapters/config/environment.js';
import { connectDatabase } from '../adapters/persistence/database.js';
import { runReferenceWorker } from '../adapters/workers/reference-worker.js';
import { createFinancialProcessing } from './financial-processing.js';

const controller = new AbortController();
const stop = () => controller.abort();
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
let database: Awaited<ReturnType<typeof connectDatabase>> | undefined;
try {
  database = await connectDatabase(loadConfig(process.env).database);
  const service = createFinancialProcessing(database);
  await runReferenceWorker(
    () => service.retryReference(),
    controller.signal,
    (event) => console.log(JSON.stringify(event)),
    process.argv.includes('--once'),
  );
} catch {
  console.error(
    JSON.stringify({ level: 'error', event: 'reference_worker_failed' }),
  );
  process.exitCode = 1;
} finally {
  await database?.close(true);
  process.off('SIGTERM', stop);
  process.off('SIGINT', stop);
}
