import type { MikroORM } from '@mikro-orm/postgresql';
import { FinancialProcessing } from '../application/financial-processing.js';
import { MikroFinancialUnitOfWork } from '../adapters/persistence/financial-unit-of-work.js';
import { financialRuntime } from '../adapters/runtime/financial-runtime.js';

export function createFinancialProcessing(orm: MikroORM): FinancialProcessing {
  return new FinancialProcessing(
    new MikroFinancialUnitOfWork(orm),
    financialRuntime,
  );
}
