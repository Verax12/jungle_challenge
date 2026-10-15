import { expect, test } from 'bun:test';
import { loadConfig } from '../../src/adapters/config/environment.js';
import { Operations } from '../../src/adapters/observability/operations.js';
import { Telemetry } from '../../src/adapters/observability/telemetry.js';
import { fixture } from './helpers.js';
import { transaction, wallet } from '../persistence/helpers.js';

test('persisted transaction metrics expose FAILED as zero and count committed failures', async () => {
  const f = await fixture();
  const config = loadConfig(process.env);
  const operations = new Operations(
    { ...config, database: { ...config.database, name: f.name } },
    new Telemetry(() => {}),
    f.names,
  );
  try {
    expect(await operations.metrics()).toContain(
      'wagering_transactions{status="FAILED"} 0',
    );
    const id = await wallet(f.orm.em);
    await transaction(f.orm.em, {
      walletId: id,
      status: 'FAILED',
      failure: 'INFRASTRUCTURE_PERMANENT',
    });
    expect(await operations.metrics()).toContain(
      'wagering_transactions{status="FAILED"} 1',
    );
  } finally {
    await operations.onApplicationShutdown();
    await f.close();
  }
});
