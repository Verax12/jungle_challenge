import 'reflect-metadata';
import type { FinancialHttpServices } from '../adapters/http/financial.controller.js';
import { FinancialErrorFilter } from '../adapters/http/financial-error.filter.js';
import { DatabaseHttpServices } from './http-services.js';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { AppConfig } from '../adapters/config/environment.js';
import { AppModule } from './app.module.js';

export async function createApplication(
  quiet = false,
  services?: FinancialHttpServices,
) {
  const app = await NestFactory.create(
    AppModule.register(services),
    new ExpressAdapter(),
    {
      logger: quiet ? false : new ConsoleLogger({ json: true }),
      abortOnError: false,
    },
  );
  app.useGlobalFilters(new FinancialErrorFilter());
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  return app;
}

export async function bootstrap(config: AppConfig) {
  const app = await createApplication(
    false,
    new DatabaseHttpServices(config.database),
  );
  try {
    await app.listen(config.http.port, config.http.host);
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
