import { MikroORM } from '@mikro-orm/postgresql';
import type { AppConfig } from '../config/environment.js';

export function connectDatabase(config: AppConfig['database']) {
  return MikroORM.init({
    host: config.host,
    port: config.port,
    dbName: config.name,
    user: config.user,
    password: config.password,
    entities: [],
    discovery: { warnWhenNoEntities: false },
    pool: { min: 0, max: 2 },
    debug: false,
  });
}
