import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Operations } from '../observability/operations.js';
import type { HttpResponse } from './financial.controller.js';
export const OPERATIONS = Symbol('OPERATIONS');
@Controller()
export class OperationsController {
  constructor(@Inject(OPERATIONS) private readonly operations: Operations) {}
  @Get('health/ready')
  async ready(@Res() response: HttpResponse) {
    const result = await this.operations.ready();
    response.status(result.status === 'ready' ? 200 : 503).json(result);
  }
  @Get('metrics')
  async metrics(@Res() response: HttpResponse & { send(value: string): void }) {
    try {
      const body = await this.operations.metrics();
      response.setHeader(
        'Content-Type',
        this.operations.telemetry.registry.contentType,
      );
      response.status(200);
      response.send(body);
    } catch {
      response.status(503).json({ code: 'METRICS_UNAVAILABLE' });
    }
  }
}
