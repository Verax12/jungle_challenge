import { expect, test } from 'bun:test';
import type { ProcessWagerCommand } from '../../src/application/financial-processing.js';
import { FinancialProcessing } from '../../src/application/financial-processing.js';
import type {
  FinancialRuntime,
  FinancialSession,
  FinancialUnitOfWork,
} from '../../src/application/ports/financial-store.js';
import {
  DomainError,
  InvalidTransactionStateError,
} from '../../src/domain/errors.js';
import { Money } from '../../src/domain/money.js';
import { Wallet } from '../../src/domain/wallet.js';
import { WagerTransactionKind } from '../../src/domain/wager-transaction.js';
import type { WagerTransaction } from '../../src/domain/wager-transaction.js';
import type { OutboxMessage } from '../../src/domain/messages.js';

const at = '2026-10-14T00:00:00.000Z';
function setup() {
  let next = 0;
  let transactions = 0;
  const messages: OutboxMessage[] = [];
  const wallet = Wallet.open({
    id: 'wallet',
    playerId: 'player',
    initialBalance: Money.zero('BRL'),
    at,
  }).wallet;
  const runtime: FinancialRuntime = {
    now: () => at,
    newId: () => `id-${++next}`,
    hash: (value) => value,
  };
  const session: FinancialSession = {
    findReceipts: async () => [],
    insertReceipt: () => {},
    lockWallet: async () => wallet,
    findReference: async () => undefined,
    wasReversed: async () => false,
    insertWallet: () => {},
    updateWallet: () => {},
    insertLedger: () => {},
    insertTransaction: () => {
      transactions++;
    },
    appendOutbox: (message) => {
      messages.push(message);
    },
  };
  const unit: FinancialUnitOfWork = { run: (work) => work(session) };
  const input: ProcessWagerCommand = {
    walletId: 'wallet',
    playerId: 'player',
    providerId: 'provider',
    externalTransactionId: 'external',
    idempotencyKey: 'key',
    roundId: 'round',
    gameId: 'game',
    kind: WagerTransactionKind.Loss,
    money: { amount: '0.00', currency: 'BRL' },
  };
  return {
    runtime,
    session,
    unit,
    input,
    messages,
    transactionCount: () => transactions,
  };
}

test.each([
  new Error('database unavailable'),
  InvalidTransactionStateError.create(),
  DomainError.for('INVALID_INPUT'),
])(
  'unexpected errors are propagated instead of fabricated business rejections: %s',
  async (error) => {
    const f = setup();
    f.session.lockWallet = async () => {
      throw error;
    };
    const app = new FinancialProcessing(f.unit, f.runtime);
    await expect(
      app.process(f.input, { correlationId: 'correlation' }),
    ).rejects.toBe(error);
    expect(f.messages).toHaveLength(0);
    expect(f.transactionCount()).toBe(0);
  },
);

test('invalid context is rejected before opening any transaction', async () => {
  const f = setup();
  let started = false;
  const app = new FinancialProcessing(
    {
      run: async () => {
        started = true;
        throw new Error('must not start');
      },
    },
    f.runtime,
  );
  await expect(app.process(f.input, { correlationId: '' })).rejects.toThrow(
    'INVALID_INPUT',
  );
  await expect(
    app.createWallet(
      { playerId: 'player', initialBalance: f.input.money },
      { correlationId: 'correlation', causationId: '' },
    ),
  ).rejects.toThrow('INVALID_INPUT');
  expect(started).toBe(false);
});

test('processing timestamp is sampled after the wallet lock is acquired', async () => {
  const f = setup();
  let now = at;
  f.runtime.now = () => now;
  const locked = await f.session.lockWallet('wallet');
  f.session.lockWallet = async () => {
    now = '2026-10-14T01:00:00.000Z';
    return locked;
  };
  let stored: WagerTransaction | undefined;
  f.session.insertTransaction = (transaction) => {
    stored = transaction;
  };
  await new FinancialProcessing(f.unit, f.runtime).process(f.input, {
    correlationId: 'correlation',
  });
  expect(stored!.createdAt).toBe(at);
  expect(stored!.processedAt).toBe(now);
  expect(f.messages[0]!.occurredAt).toBe(now);
});

test('errors raised by domain transition do not become terminal business outcomes', async () => {
  const f = setup();
  const wallet = await f.session.lockWallet('wallet');
  wallet!.apply = () => {
    throw InvalidTransactionStateError.create();
  };
  await expect(
    new FinancialProcessing(f.unit, f.runtime).process(f.input, {
      correlationId: 'correlation',
    }),
  ).rejects.toBeInstanceOf(InvalidTransactionStateError);
  expect(f.transactionCount()).toBe(0);
  expect(f.messages).toHaveLength(0);
});
