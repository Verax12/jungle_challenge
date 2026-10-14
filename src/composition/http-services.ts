import type { AppConfig } from '../adapters/config/environment.js';
import type { FinancialHttpServices } from '../adapters/http/financial.controller.js';
import { connectDatabase } from '../adapters/persistence/database.js';
import { MikroFinancialQueries } from '../adapters/persistence/financial-queries.js';
import { createFinancialProcessing } from './financial-processing.js';

export class DatabaseHttpServices implements FinancialHttpServices {
  private database: ReturnType<typeof connectDatabase> | undefined;
  constructor(private readonly config: AppConfig['database']) {}
  private connect() {
    if (!this.database) {
      this.database = connectDatabase(this.config).catch((error: unknown) => {
        this.database = undefined;
        throw error;
      });
    }
    return this.database;
  }
  readonly processing: FinancialHttpServices['processing'] = {
    createWallet: async (command, context) =>
      createFinancialProcessing(await this.connect()).createWallet(
        command,
        context,
      ),
    process: async (command, context) =>
      createFinancialProcessing(await this.connect()).process(command, context),
  };
  readonly queries: FinancialHttpServices['queries'] = {
    wallet: async (id) =>
      new MikroFinancialQueries(await this.connect()).wallet(id),
    transaction: async (id) =>
      new MikroFinancialQueries(await this.connect()).transaction(id),
    externalTransaction: async (provider, external) =>
      new MikroFinancialQueries(await this.connect()).externalTransaction(
        provider,
        external,
      ),
    ledger: async (id, cursor, limit) =>
      new MikroFinancialQueries(await this.connect()).ledger(id, cursor, limit),
  };
  async onApplicationShutdown(): Promise<void> {
    const database = await this.database?.catch(() => undefined);
    await database?.close(true);
  }
}
