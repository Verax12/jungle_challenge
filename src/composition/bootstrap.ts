import 'reflect-metadata';
import type { FinancialHttpServices } from '../adapters/http/financial.controller.js';
import { FinancialErrorFilter } from '../adapters/http/financial-error.filter.js';
import { DatabaseHttpServices } from './http-services.js';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { AppConfig } from '../adapters/config/environment.js';
import { AppModule } from './app.module.js';

import { Operations } from '../adapters/observability/operations.js';
import { Telemetry } from '../adapters/observability/telemetry.js';
import { requestObserver } from '../adapters/http/request-observer.js';

export async function createApplication(
  quiet = false,
  services?: FinancialHttpServices,
  operations?: Operations,
) {
  const app = await NestFactory.create(
    AppModule.register(services, operations),
    new ExpressAdapter(),
    {
      logger: quiet ? false : new ConsoleLogger({ json: true }),
      abortOnError: false,
    },
  );
  if (operations) app.use(requestObserver(operations.telemetry));
  app.useGlobalFilters(new FinancialErrorFilter());
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  return app;
}

export async function bootstrap(config: AppConfig) {
  const telemetry = new Telemetry();
  const app = await createApplication(
    false,
    new DatabaseHttpServices(config.database, telemetry),
    new Operations(config, telemetry),
  );
  try {
    await app.listen(config.http.port, config.http.host);
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
