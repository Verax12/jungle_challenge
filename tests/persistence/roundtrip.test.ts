import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Wallet } from '../../src/domain/wallet.js';
import { Money } from '../../src/domain/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
} from '../../src/domain/wager-transaction.js';
import { WagerTransactionProcessed } from '../../src/domain/events.js';
import { InboxMessage, OutboxMessage } from '../../src/domain/messages.js';
import {
  WalletEntity,
  TransactionEntity,
  LedgerEntity,
  InboxEntity,
  OutboxEntity,
} from '../../src/adapters/persistence/entities.js';
import {
  walletMapper,
  transactionMapper,
  ledgerMapper,
  inboxMapper,
  outboxMapper,
} from '../../src/adapters/persistence/mappers.js';
import {
  disposableDatabase,
  at,
  later,
  unique,
  sql,
  expectSqlFailure,
} from './helpers.js';

let fixture: Awaited<ReturnType<typeof disposableDatabase>>;
beforeAll(async () => {
  fixture = await disposableDatabase();
  await fixture.orm.getMigrator().up();
});
afterAll(async () => {
  await fixture?.close();
});

function models(amount = '90071992547409931234567890.99', currency = 'BRL') {
  const { wallet, opening } = Wallet.open({
    id: unique(),
    playerId: unique(),
    initialBalance: Money.from({ amount, currency }),
    at,
    opening: {
      transactionId: unique(),
      entryId: unique(),
      payloadHash: 'opening-hash',
    },
  });
  const inbox = InboxMessage.receive({
    consumerName: 'consumer',
    messageId: unique(),
    payloadHash: 'message-hash',
    receivedAt: at,
  });
  inbox.markProcessed(later);
  const outbox = OutboxMessage.enqueue(
    WagerTransactionProcessed.from(opening!.transaction, {
      eventId: unique(),
      correlationId: unique(),
      occurredAt: at,
    }),
  );
  outbox.scheduleRetry(later, { baseDelayMs: 100, maxDelayMs: 500 });
  return { wallet, opening: opening!, inbox, outbox };
}

test.each(['BRL', 'USD', 'EUR'])(
  'five models round trip through MikroORM and rehydrate without monetary loss: %s',
  async (currency) => {
    const model = models('999999999999999999999999999999999999.99', currency);
    await fixture.orm.em.fork().transactional(async (em) => {
      em.create(WalletEntity, walletMapper.toRecord(model.wallet));
      em.create(
        TransactionEntity,
        transactionMapper.toRecord(model.opening.transaction),
      );
      em.create(
        LedgerEntity,
        ledgerMapper.toRecord(model.opening.entry, model.wallet.version),
      );
      em.create(InboxEntity, inboxMapper.toRecord(model.inbox));
      em.create(OutboxEntity, outboxMapper.toRecord(model.outbox));
    });
    const em = fixture.orm.em.fork();
    const wallet = walletMapper.toDomain(
      await em.findOneOrFail(WalletEntity, { id: model.wallet.id }),
    );
    const tx = transactionMapper.toDomain(
      await em.findOneOrFail(TransactionEntity, {
        id: model.opening.transaction.id,
      }),
    );
    const entry = ledgerMapper.toDomain(
      await em.findOneOrFail(LedgerEntity, { id: model.opening.entry.id }),
    );
    const inbox = inboxMapper.toDomain(
      await em.findOneOrFail(InboxEntity, {
        consumerName: model.inbox.consumerName,
        messageId: model.inbox.messageId,
      }),
    );
    const outbox = outboxMapper.toDomain(
      await em.findOneOrFail(OutboxEntity, { id: model.outbox.id }),
    );
    expect(wallet.snapshot()).toEqual(model.wallet.snapshot());
    expect(tx.snapshot()).toEqual(model.opening.transaction.snapshot());
    expect(entry.snapshot()).toEqual(model.opening.entry.snapshot());
    expect(inbox.snapshot()).toEqual(model.inbox.snapshot());
    expect(outbox.snapshot()).toEqual(model.outbox.snapshot());
    expect(entry.isBalanced()).toBe(true);
    expect(outbox.isDue(model.outbox.nextAttemptAt!)).toBe(true);
    expect(JSON.stringify(tx.money)).toBe(
      JSON.stringify(model.opening.transaction.money),
    );
  },
);

test('zero SQL scale is normalized on hydration and nullable fields survive', async () => {
  const model = Wallet.open({
    id: unique(),
    playerId: unique(),
    initialBalance: Money.zero('BRL'),
    at,
  }).wallet;
  await fixture.orm.em
    .fork()
    .persistAndFlush(
      fixture.orm.em.fork().create(WalletEntity, walletMapper.toRecord(model)),
    );
  const em = fixture.orm.em.fork();
  const record = await em.findOneOrFail(WalletEntity, { id: model.id });
  expect(record.balance).toBe('0.00');
  const tx = WagerTransaction.create({
    id: unique(),
    providerId: 'provider',
    externalTransactionId: unique(),
    idempotencyKey: unique(),
    payloadHash: 'hash',
    walletId: model.id,
    playerId: model.playerId,
    roundId: 'round',
    gameId: 'game',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '1.00', currency: 'BRL' }),
    createdAt: at,
  });
  await em.persistAndFlush(
    em.create(TransactionEntity, transactionMapper.toRecord(tx)),
  );
  em.clear();
  expect(
    transactionMapper
      .toDomain(await em.findOneOrFail(TransactionEntity, { id: tx.id }))
      .snapshot(),
  ).toEqual(tx.snapshot());
});

test('Unit of Work updates wallet with its transaction and ledger, retaining the balance chain', async () => {
  const model = models('100.00');
  await fixture.orm.em.fork().transactional(async (em) => {
    em.create(WalletEntity, walletMapper.toRecord(model.wallet));
    em.create(
      TransactionEntity,
      transactionMapper.toRecord(model.opening.transaction),
    );
    em.create(LedgerEntity, ledgerMapper.toRecord(model.opening.entry, 1));
  });
  const tx = WagerTransaction.create({
    id: unique(),
    providerId: 'p',
    externalTransactionId: unique(),
    idempotencyKey: unique(),
    payloadHash: 'h',
    walletId: model.wallet.id,
    playerId: model.wallet.playerId,
    roundId: 'r',
    gameId: 'g',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '80.00', currency: 'BRL' }),
    createdAt: at,
  });
  await fixture.orm.em.fork().transactional(async (em) => {
    const record = await em.findOneOrFail(WalletEntity, {
      id: model.wallet.id,
    });
    const restored = walletMapper.toDomain(record);
    const entry = restored.apply(tx, { entryId: unique(), at: later })!;
    em.assign(record, walletMapper.toRecord(restored));
    em.create(TransactionEntity, transactionMapper.toRecord(tx));
    em.create(LedgerEntity, ledgerMapper.toRecord(entry, restored.version));
  });
  const record = await fixture.orm.em
    .fork()
    .findOneOrFail(WalletEntity, { id: model.wallet.id });
  expect(record.balance).toBe('20.00');
  expect(record.version).toBe(2);
});

test('exception after flush rolls back all five models together', async () => {
  const model = models();
  await expect(
    fixture.orm.em.fork().transactional(async (em) => {
      em.create(WalletEntity, walletMapper.toRecord(model.wallet));
      em.create(
        TransactionEntity,
        transactionMapper.toRecord(model.opening.transaction),
      );
      em.create(LedgerEntity, ledgerMapper.toRecord(model.opening.entry, 1));
      em.create(InboxEntity, inboxMapper.toRecord(model.inbox));
      em.create(OutboxEntity, outboxMapper.toRecord(model.outbox));
      await em.flush();
      throw new Error('induced rollback');
    }),
  ).rejects.toThrow('induced rollback');
  const em = fixture.orm.em.fork();
  expect(await em.findOne(WalletEntity, { id: model.wallet.id })).toBeNull();
  expect(
    await em.findOne(TransactionEntity, { id: model.opening.transaction.id }),
  ).toBeNull();
  expect(
    await em.findOne(LedgerEntity, { id: model.opening.entry.id }),
  ).toBeNull();
  expect(
    await em.findOne(InboxEntity, {
      consumerName: model.inbox.consumerName,
      messageId: model.inbox.messageId,
    }),
  ).toBeNull();
  expect(await em.findOne(OutboxEntity, { id: model.outbox.id })).toBeNull();
});

test('resolved reference and refund survive ORM persistence and rehydration', async () => {
  const model = models('100.00');
  await fixture.orm.em.fork().transactional(async (em) => {
    em.create(WalletEntity, walletMapper.toRecord(model.wallet));
    em.create(
      TransactionEntity,
      transactionMapper.toRecord(model.opening.transaction),
    );
    em.create(LedgerEntity, ledgerMapper.toRecord(model.opening.entry, 1));
  });
  const bet = WagerTransaction.create({
    id: unique(),
    providerId: 'provider',
    externalTransactionId: unique(),
    idempotencyKey: unique(),
    payloadHash: 'bet-hash',
    walletId: model.wallet.id,
    playerId: model.wallet.playerId,
    roundId: 'round',
    gameId: 'game',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '25.00', currency: 'BRL' }),
    createdAt: at,
  });
  const refund = WagerTransaction.create({
    ...bet.snapshot(),
    id: unique(),
    externalTransactionId: unique(),
    idempotencyKey: unique(),
    kind: WagerTransactionKind.Refund,
    referenceExternalTransactionId: bet.externalTransactionId,
  });
  for (const tx of [bet, refund]) {
    await fixture.orm.em.fork().transactional(async (em) => {
      const row = await em.findOneOrFail(WalletEntity, { id: model.wallet.id });
      const restored = walletMapper.toDomain(row);
      const ref =
        tx === refund
          ? transactionMapper.toDomain(
              await em.findOneOrFail(TransactionEntity, { id: bet.id }),
            )
          : undefined;
      const entry = restored.apply(tx, {
        entryId: unique(),
        at: later,
        ...(ref ? { reference: ref, alreadyReversed: false } : {}),
      })!;
      em.assign(row, walletMapper.toRecord(restored));
      em.create(TransactionEntity, transactionMapper.toRecord(tx));
      em.create(LedgerEntity, ledgerMapper.toRecord(entry, restored.version));
    });
  }
  const em = fixture.orm.em.fork();
  const restored = transactionMapper.toDomain(
    await em.findOneOrFail(TransactionEntity, { id: refund.id }),
  );
  expect(restored.snapshot()).toEqual(refund.snapshot());
  expect(restored.referenceTransactionId).toBe(bet.id);
  expect(restored.referenceExternalTransactionId).toBe(
    bet.externalTransactionId,
  );
  expect(
    (await em.findOneOrFail(WalletEntity, { id: model.wallet.id })).balance,
  ).toBe('100.00');
});

test('deferred inconsistency fails on commit even when the ORM flush itself succeeds', async () => {
  const model = models('10.00');
  let flushed = false;
  await expectSqlFailure(
    () =>
      fixture.orm.em.fork().transactional(async (em) => {
        em.create(WalletEntity, walletMapper.toRecord(model.wallet));
        await em.flush();
        flushed = true;
      }),
    '23514',
  );
  expect(flushed).toBe(true);
  expect(
    await fixture.orm.em.fork().findOne(WalletEntity, { id: model.wallet.id }),
  ).toBeNull();
});

test('outbox payload cannot be rewritten, attempts cannot regress and published state is terminal', async () => {
  const model = models();
  const record = outboxMapper.toRecord(model.outbox);
  const em = fixture.orm.em.fork();
  await em.persistAndFlush(em.create(OutboxEntity, record));
  await expectSqlFailure(
    () =>
      sql(
        em,
        "update outbox_messages set payload = jsonb_set(payload, '{data}', '{}') where id = ?",
        [record.id],
      ),
    '23514',
  );
  await expectSqlFailure(
    () =>
      sql(em, 'update outbox_messages set attempts = 0 where id = ?', [
        record.id,
      ]),
    '23514',
  );
  model.outbox.markPublished(model.outbox.nextAttemptAt!);
  const stored = await em.findOneOrFail(OutboxEntity, { id: record.id });
  em.assign(stored, outboxMapper.toRecord(model.outbox));
  await em.flush();
  em.clear();
  expect(
    outboxMapper
      .toDomain(await em.findOneOrFail(OutboxEntity, { id: record.id }))
      .isPending(),
  ).toBe(false);
  await expectSqlFailure(
    () =>
      sql(em, 'update outbox_messages set published_at = null where id = ?', [
        record.id,
      ]),
    '23514',
  );
  await expectSqlFailure(
    () => sql(em, 'delete from outbox_messages where id = ?', [record.id]),
    '23514',
  );
});

test('invalid outbox envelope and invalid retry counters fail in SQL', async () => {
  const model = models();
  const record = outboxMapper.toRecord(model.outbox);
  await expectSqlFailure(
    () =>
      fixture.orm.em
        .fork()
        .persistAndFlush(
          fixture.orm.em
            .fork()
            .create(OutboxEntity, { ...record, payload: {} }),
        ),
    '23514',
  );
  await expectSqlFailure(
    () =>
      fixture.orm.em
        .fork()
        .persistAndFlush(
          fixture.orm.em
            .fork()
            .create(OutboxEntity, { ...record, attempts: -1 }),
        ),
    '23514',
  );
});

test('database lifecycle commands work from the compiled entrypoint on an isolated database', async () => {
  const other = await disposableDatabase();
  try {
    for (const action of ['up', 'status', 'down', 'up']) {
      const result = Bun.spawnSync(
        [process.execPath, 'dist/composition/migrate.js', action],
        {
          env: { ...process.env, DB_NAME: other.name },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      expect(result.exitCode).toBe(0);
      if (action === 'status')
        expect(result.stdout.toString()).toContain('Migration202610140001');
    }
  } finally {
    await other.close();
  }
});
