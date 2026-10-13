import {
  ConfigurationError,
  loadConfig,
} from '../adapters/config/environment.js';
import { bootstrap } from './bootstrap.js';

try {
  await bootstrap(loadConfig(process.env));
} catch (error) {
  console.error(
    JSON.stringify({
      level: 'error',
      message:
        error instanceof ConfigurationError
          ? error.message
          : 'Falha ao iniciar a aplicação.',
    }),
  );
  process.exitCode = 1;
}
