import { expect, test } from 'bun:test';
import { textId } from '../../src/adapters/http/contracts.js';
import { parseWagerMessage } from '../../src/adapters/messaging/request-contract.js';

test.each([
  '\ud800',
  '\udfff',
  '\ud800x',
  'x\udfff',
  '\ud800\ud800',
  '\udfff\ud800',
])(
  'identity rejects malformed Unicode %j before UTF-8 can replace it',
  (value) => {
    expect(() => textId(value)).toThrow('INVALID_INPUT');
  },
);

test.each(['provedor-😀', 'jogador-José', '游戏', 'replacement-�'])(
  'identity preserves valid Unicode %j exactly',
  (value) => {
    expect(textId(value)).toBe(value);
    expect(Buffer.from(textId(value), 'utf8').toString('utf8')).toBe(value);
  },
);

test.each(['messageId', 'correlationId', 'idempotencyKey'])(
  'SQS validates Unicode in transport identity %s',
  (field) => {
    const envelope = {
      messageId: 'message',
      correlationId: 'correlation',
      type: 'WagerTransactionRequested',
      occurredAt: '2026-10-15T00:00:00.000Z',
      data: {
        providerId: 'provider',
        externalTransactionId: 'external',
        idempotencyKey: 'key',
        playerId: 'player',
        walletId: 'wallet',
        roundId: 'round',
        gameId: 'game',
        kind: 'BET',
        money: { amount: '25.00', currency: 'BRL' },
      },
    };
    if (field === 'idempotencyKey') envelope.data.idempotencyKey = '\ud800';
    else envelope[field as 'messageId' | 'correlationId'] = '\udfff';
    expect(() => parseWagerMessage(JSON.stringify(envelope))).toThrow(
      'INVALID_INPUT',
    );
  },
);
