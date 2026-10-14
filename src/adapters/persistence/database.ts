import { MikroORM } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import type { AppConfig } from '../config/environment.js';
import { entities } from './entities.js';
import { Migration202610140001 } from './migrations/Migration202610140001.js';
import { Migration202610140002 } from './migrations/Migration202610140002.js';
import { Migration202610140003 } from './migrations/Migration202610140003.js';

export function connectDatabase(config: AppConfig['database']) {
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
      ],
      transactional: true,
      allOrNothing: true,
      disableForeignKeys: false,
    },
    pool: { min: 0, max: 2 },
    debug: false,
  });
}
