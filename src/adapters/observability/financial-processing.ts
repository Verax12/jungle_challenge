import type { FinancialProcessing } from '../../application/financial-processing.js';
import type { Telemetry } from './telemetry.js';

export class ObservedFinancialProcessing {
  constructor(
    private readonly service: FinancialProcessing,
    private readonly telemetry: Telemetry,
  ) {}
  async createWallet(...args: Parameters<FinancialProcessing['createWallet']>) {
    const result = await this.telemetry.observe('http', { ...args[1] }, () =>
      this.service.createWallet(...args),
    );
    this.telemetry.report({
      event: 'wallet_created',
      ...args[1],
      walletId: result.id,
    });
    return result;
  }
  async process(...args: Parameters<FinancialProcessing['process']>) {
    const [command, context, delivery] = args;
    const source = delivery ? 'sqs' : 'http';
    const fields = {
      correlationId: context.correlationId,
      messageId: delivery?.messageId,
      providerId: command.providerId,
      walletId: command.walletId,
    };
    const result = await this.telemetry.observe(source, fields, () =>
      this.service.process(...args),
    );
    this.telemetry.outcome(source, result);
    this.telemetry.report({
      event: 'transaction_committed',
      ...fields,
      transactionId: result.transactionId,
      status: result.status,
      idempotentReplay: result.idempotentReplay,
    });
    return result;
  }
  async retryReference() {
    const result = await this.telemetry.observe('reference', {}, () =>
      this.service.retryReference(),
    );
    if (result && result.status !== 'PENDING_REFERENCE')
      this.telemetry.outcome('reference', result);
    return result;
  }
}
