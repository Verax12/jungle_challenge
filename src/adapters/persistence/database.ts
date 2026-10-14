import { MikroORM } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import type { AppConfig } from '../config/environment.js';
import { entities } from './entities.js';
import { Migration202610140001 } from './migrations/Migration202610140001.js';
import { Migration202610140002 } from './migrations/Migration202610140002.js';
import { Migration202610140003 } from './migrations/Migration202610140003.js';

import { Migration202610140004 } from './migrations/Migration202610140004.js';

export function connectDatabase(
  config: AppConfig['database'],
  operational = false,
) {
  return MikroORM.init({
    host: config.host,
    port: config.port,
    dbName: config.name,
    user: config.user,
    password: config.password,
    entities,
    extensions: [Migrator],
    migrations: {
      migrationsList: [
        Migration202610140001,
        Migration202610140002,
        Migration202610140003,
        Migration202610140004,
      ],
      transactional: true,
      allOrNothing: true,
      disableForeignKeys: false,
    },
    pool: {
      min: 0,
      max: 2,
      ...(operational ? { acquireTimeoutMillis: 2000 } : {}),
    },
    ...(operational
      ? {
          driverOptions: {
            connection: {
              connectionTimeoutMillis: 2000,
              statement_timeout: 2000,
              query_timeout: 2500,
            },
          },
        }
      : {}),
    debug: false,
  });
}
