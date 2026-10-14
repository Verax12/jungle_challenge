import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  Injectable,
} from '@nestjs/common';
import type { CanActivate } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FinancialProcessing } from '../../application/financial-processing.js';
import type { FinancialQueries } from '../../application/ports/financial-queries.js';
import { ensure } from '../../domain/errors.js';
import { walletBody, wagerBody, ledgerQuery, textId } from './contracts.js';

export const FINANCIAL_HTTP = Symbol('FINANCIAL_HTTP');
export interface FinancialHttpServices {
  processing: Pick<FinancialProcessing, 'createWallet' | 'process'>;
  queries: FinancialQueries;
}
interface HttpRequest {
  correlationId?: string;
  headers: Record<string, string | string[] | undefined>;
  rawHeaders: string[];
}
export interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}
@Injectable()
export class OpenBusinessAccessGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
function context(request: HttpRequest) {
  const supplied = request.headers['x-correlation-id'];
  return {
    correlationId:
      supplied === undefined
        ? (request.correlationId ?? randomUUID())
        : textId(supplied),
  };
}
@Controller()
@UseGuards(OpenBusinessAccessGuard)
export class FinancialController {
  constructor(
    @Inject(FINANCIAL_HTTP) private readonly services: FinancialHttpServices,
  ) {}
  @Post('wallets')
  createWallet(@Body() body: unknown, @Req() request: HttpRequest) {
    return this.services.processing.createWallet(
      walletBody(body),
      context(request),
    );
  }
  @Post('wallets/:walletId/reconciliation')
  async reconciliation(
    @Param('walletId') walletId: string,
    @Req() request: HttpRequest,
    @Res() response: HttpResponse,
  ) {
    const result = await this.services.queries.reconciliation(
      textId(walletId),
      context(request),
    );
    response.status(200).json(result);
  }
  @Get('wallets/:walletId')
  wallet(@Param('walletId') walletId: string) {
    return this.services.queries.wallet(textId(walletId));
  }
  @Get('wallets/:walletId/ledger')
  ledger(@Param('walletId') walletId: string, @Query() query: unknown) {
    const { cursor, limit } = ledgerQuery(query);
    return this.services.queries.ledger(textId(walletId), cursor, limit);
  }
  @Get('wagering/transactions/:transactionId')
  transaction(@Param('transactionId') id: string) {
    return this.services.queries.transaction(textId(id));
  }
  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  external(
    @Param('providerId') provider: string,
    @Param('externalTransactionId') external: string,
  ) {
    return this.services.queries.externalTransaction(
      textId(provider),
      textId(external),
    );
  }
  @Post('wagering/transactions')
  async process(
    @Body() body: unknown,
    @Req() request: HttpRequest,
    @Res() response: HttpResponse,
  ) {
    const occurrences = request.rawHeaders.filter(
      (header, index) =>
        index % 2 === 0 && header.toLowerCase() === 'idempotency-key',
    ).length;
    ensure(occurrences === 1);
    const result = await this.services.processing.process(
      wagerBody(body, request.headers['idempotency-key']),
      context(request),
    );
    const code =
      result.status === 'REJECTED'
        ? 422
        : result.status === 'PENDING_REFERENCE'
          ? 202
          : result.idempotentReplay
            ? 200
            : 201;
    response.status(code).json(result);
  }
}
