import { randomUUID } from 'node:crypto';
import type { Telemetry } from '../observability/telemetry.js';
import { textId } from './contracts.js';
interface Request {
  headers: Record<string, string | string[] | undefined>;
  correlationId?: string;
  params?: Record<string, string>;
}
interface Response {
  statusCode: number;
  setHeader(name: string, value: string): void;
  on(event: 'finish', callback: () => void): void;
}
export function requestObserver(telemetry: Telemetry) {
  return (request: Request, response: Response, next: () => void) => {
    let correlationId = randomUUID() as string;
    try {
      if (request.headers['x-correlation-id'] !== undefined)
        correlationId = textId(request.headers['x-correlation-id']);
    } catch {
      /* Validation remains with the request contract. */
    }
    request.correlationId = correlationId;
    response.setHeader('X-Correlation-Id', correlationId);
    const start = performance.now();
    response.on('finish', () =>
      telemetry.report({
        event: 'http_completed',
        correlationId,
        status: String(response.statusCode),
        walletId: request.params?.walletId,
        providerId: request.params?.providerId,
        transactionId: request.params?.transactionId,
        durationSeconds: (performance.now() - start) / 1000,
      }),
    );
    next();
  };
}
