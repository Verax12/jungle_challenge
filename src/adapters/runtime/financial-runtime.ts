import { createHash, randomUUID } from 'node:crypto';
import type { FinancialRuntime } from '../../application/ports/financial-store.js';

export const financialRuntime: FinancialRuntime = {
  now: () => new Date().toISOString(),
  newId: () => randomUUID(),
  hash: (value) => createHash('sha256').update(value).digest('hex'),
};
