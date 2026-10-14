import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { LivenessController } from '../adapters/http/liveness.controller.js';
import {
  FinancialController,
  FINANCIAL_HTTP,
  OpenBusinessAccessGuard,
} from '../adapters/http/financial.controller.js';
import type { FinancialHttpServices } from '../adapters/http/financial.controller.js';

@Module({})
export class AppModule {
  static register(services?: FinancialHttpServices): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        LivenessController,
        ...(services ? [FinancialController] : []),
      ],
      providers: services
        ? [
            { provide: FINANCIAL_HTTP, useValue: services },
            OpenBusinessAccessGuard,
          ]
        : [],
    };
  }
}
