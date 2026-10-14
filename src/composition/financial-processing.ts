import type { MikroORM } from '@mikro-orm/postgresql';
import { FinancialProcessing } from '../application/financial-processing.js';
import { MikroFinancialUnitOfWork } from '../adapters/persistence/financial-unit-of-work.js';
import { financialRuntime } from '../adapters/runtime/financial-runtime.js';

import { ObservedFinancialProcessing } from '../adapters/observability/financial-processing.js';
import type { Telemetry } from '../adapters/observability/telemetry.js';

export function createFinancialProcessing(orm: MikroORM): FinancialProcessing;
export function createFinancialProcessing(
  orm: MikroORM,
  telemetry: Telemetry | undefined,
): FinancialProcessing | ObservedFinancialProcessing;
export function createFinancialProcessing(
  orm: MikroORM,
  telemetry?: Telemetry,
) {
  const service = new FinancialProcessing(
    new MikroFinancialUnitOfWork(orm),
    financialRuntime,
  );
  return telemetry
    ? new ObservedFinancialProcessing(service, telemetry)
    : service;
}
