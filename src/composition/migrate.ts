import { loadConfig } from '../adapters/config/environment.js';
import { connectDatabase } from '../adapters/persistence/database.js';

const action = process.argv[2];
if (!['up', 'down', 'status'].includes(action ?? '')) {
  console.error('Usage: bun dist/composition/migrate.js up|down|status');
  process.exitCode = 1;
} else {
  const orm = await connectDatabase(loadConfig(process.env).database);
  try {
    const migrator = orm.getMigrator();
    if (action === 'up') await migrator.up();
    else if (action === 'down') await migrator.down();
    else
      console.log(
        JSON.stringify({
          executed: await migrator.getExecutedMigrations(),
          pending: await migrator.getPendingMigrations(),
        }),
      );
  } finally {
    await orm.close(true);
  }
}
