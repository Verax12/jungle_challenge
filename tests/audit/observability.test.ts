import { expect, test } from 'bun:test';
import { loadConfig } from '../../src/adapters/config/environment.js';
import { Operations } from '../../src/adapters/observability/operations.js';
import { Telemetry } from '../../src/adapters/observability/telemetry.js';
import { fixture } from '../messaging/helpers.js';
import { transaction, wallet } from '../persistence/helpers.js';

test('persisted transaction metrics include the supported FAILED status', async () => {
  const f = await fixture();
  const config = loadConfig(process.env);
  const operations = new Operations(
    { ...config, database: { ...config.database, name: f.name } },
    new Telemetry(() => {}),
    f.names,
  );
  try {
    const id = await wallet(f.orm.em);
    await transaction(f.orm.em, {
      walletId: id,
      status: 'FAILED',
      failure: 'INFRASTRUCTURE_PERMANENT',
    });
    const metrics = await operations.metrics();
    const series = metrics
      .split('\n')
      .filter((line) => line.startsWith('wagering_transactions{'));
    console.log(
      JSON.stringify({
        scenario: 'failed-status-metrics',
        persistedFailed: 1,
        series,
      }),
    );
    expect(series).toContain('wagering_transactions{status="FAILED"} 1');
  } finally {
    await operations.onApplicationShutdown();
    await f.close();
  }
});
