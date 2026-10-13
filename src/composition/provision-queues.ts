import { loadConfig } from '../adapters/config/environment.js';
import {
  createLocalSqsClient,
  provisionQueues,
} from '../adapters/messaging/local-sqs.js';

const client = createLocalSqsClient(loadConfig(process.env).sqs);
try {
  await provisionQueues(client);
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Filas FIFO locais provisionadas.',
    }),
  );
} catch {
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'Falha ao provisionar filas locais.',
    }),
  );
  process.exitCode = 1;
} finally {
  client.destroy();
}
