import { expect, test } from 'bun:test';
import { Telemetry } from '../../src/adapters/observability/telemetry.js';

test.each(['http', 'sqs'] as const)(
  '%s outcomes expose FAILED before processing and count it without replay inflation',
  async (source) => {
    const telemetry = new Telemetry(() => {});
    const failedSeries = `wagering_processing_results_total{source="${source}",status="FAILED"}`;
    expect(await telemetry.registry.metrics()).toContain(`${failedSeries} 0`);

    telemetry.outcome(source, { status: 'FAILED' });
    telemetry.outcome(source, { status: 'FAILED', idempotentReplay: true });

    const metrics = await telemetry.registry.metrics();
    expect(metrics).toContain(`${failedSeries} 1`);
    expect(metrics).toContain(
      `wagering_duplicates_total{source="${source}"} 1`,
    );
  },
);
