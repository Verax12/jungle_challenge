import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { DomainError } from '../../domain/errors.js';
import { IdempotencyConflictError } from '../../application/idempotency.js';
import {
  FinancialConflictError,
  WalletNotFoundError,
} from '../../application/ports/financial-store.js';
import { TransactionNotFoundError } from '../../application/ports/financial-queries.js';
import type { HttpResponse } from './financial.controller.js';

export function errorResponse(error: unknown): {
  status: number;
  code: string;
} {
  if (error instanceof DomainError) return { status: 400, code: error.code };
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: 'IDEMPOTENCY_CONFLICT' };
  if (error instanceof FinancialConflictError)
    return {
      status: 409,
      code:
        error.resource === 'wallet'
          ? 'WALLET_ALREADY_EXISTS'
          : 'TRANSACTION_IDENTITY_CONFLICT',
    };
  if (error instanceof WalletNotFoundError)
    return { status: 404, code: 'WALLET_NOT_FOUND' };
  if (error instanceof TransactionNotFoundError)
    return { status: 404, code: 'TRANSACTION_NOT_FOUND' };
  if (error instanceof HttpException) {
    const status = error.getStatus();
    return {
      status,
      code:
        status === 404
          ? 'NOT_FOUND'
          : status === 413
            ? 'PAYLOAD_TOO_LARGE'
            : status === 401
              ? 'UNAUTHORIZED'
              : status === 403
                ? 'FORBIDDEN'
                : status < 500
                  ? 'INVALID_REQUEST'
                  : 'INTERNAL_ERROR',
    };
  }
  const driver = error as {
    code?: string;
    name?: string;
    cause?: { code?: string };
  } | null;
  const code = driver?.code ?? driver?.cause?.code;
  if (
    driver?.name === 'KnexTimeoutError' ||
    (typeof code === 'string' &&
      (code.startsWith('08') ||
        [
          '40001',
          '40P01',
          '55P03',
          '57014',
          '53300',
          '57P01',
          '57P02',
          '57P03',
          'ECONNREFUSED',
          'ECONNRESET',
          'ETIMEDOUT',
          'EPIPE',
        ].includes(code)))
  )
    return { status: 503, code: 'INFRASTRUCTURE_TRANSIENT' };
  return { status: 500, code: 'INTERNAL_ERROR' };
}
@Catch()
export class FinancialErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const result = errorResponse(error);
    const response = host.switchToHttp().getResponse<HttpResponse>();
    if (result.status === 503) response.setHeader('Retry-After', '1');
    response.status(result.status).json({ code: result.code });
  }
}
