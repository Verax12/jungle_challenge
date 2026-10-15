import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { command, productionStack, unique, until } from './helpers.js';
import type { LedgerPage, Outcome } from './helpers.js';

let stack: Awaited<ReturnType<typeof productionStack>>;
beforeAll(async () => {
  stack = await productionStack();
});
afterAll(async () => {
  await stack?.close();
});
afterEach(async () => {
  if (!stack) return;
  expect(
    await stack.read<{ id: string }>(
      `select w.id from wallets w where w.balance <> coalesce((
      select sum(case direction when 'CREDIT' then amount else -amount end)
      from wallet_ledger_entries where wallet_id=w.id),0)`,
    ),
  ).toEqual([]);
});

test('production HTTP applies all five kinds, preserves original replays and paginates a stable reconciled ledger', async () => {
  const wallet = await stack.open();
  const bet = command(wallet);
  const applied = await stack.submit(bet);
  expect(applied.status).toBe(201);
  expect(applied.body).toMatchObject({
    status: 'PROCESSED',
    balance: { amount: '75.00' },
    walletVersion: 2,
  });
  const win = command(wallet, {
    kind: 'WIN',
    money: { amount: '10.00', currency: 'BRL' },
    referenceExternalTransactionId: bet.externalTransactionId,
  });
  const won = await stack.submit(win);
  expect(won.status).toBe(201);
  expect(won.body.balance.amount).toBe('85.00');
  const lost = await stack.submit(
    command(wallet, {
      kind: 'LOSS',
      money: { amount: '0.00', currency: 'BRL' },
    }),
  );
  expect(lost.status).toBe(201);
  expect(lost.body).toMatchObject({
    status: 'PROCESSED',
    balance: { amount: '85.00' },
    walletVersion: 3,
  });
  const refunded = await stack.submit(
    command(wallet, {
      kind: 'REFUND',
      referenceExternalTransactionId: bet.externalTransactionId,
    }),
  );
  expect(refunded.status).toBe(201);
  expect(refunded.body.balance.amount).toBe('110.00');
  const rolledBack = await stack.submit(
    command(wallet, {
      kind: 'ROLLBACK',
      money: { amount: '10.00', currency: 'BRL' },
      referenceExternalTransactionId: win.externalTransactionId,
    }),
  );
  expect(rolledBack.status).toBe(201);
  expect(rolledBack.body.balance.amount).toBe('100.00');
  const tooLarge = command(wallet, {
    money: { amount: '200.00', currency: 'BRL' },
  });
  const rejected = await stack.submit(tooLarge);
  expect(rejected.status).toBe(422);
  expect(rejected.body).toMatchObject({
    status: 'REJECTED',
    failureCode: 'INSUFFICIENT_FUNDS',
    walletVersion: 5,
  });

  const replay = await stack.submit(bet);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual({ ...applied.body, idempotentReplay: true });
  const rejectedReplay = await stack.submit(tooLarge);
  expect(rejectedReplay.status).toBe(422);
  expect(rejectedReplay.body).toEqual({
    ...rejected.body,
    idempotentReplay: true,
  });
  expect(
    (
      await stack.submit({
        ...bet,
        money: { amount: '26.00', currency: 'BRL' },
      })
    ).status,
  ).toBe(409);
  const queried = await stack.external(win);
  expect(queried.status).toBe(200);
  expect(queried.body).toMatchObject({
    id: won.body.transactionId,
    kind: 'WIN',
    status: 'PROCESSED',
  });
  expect(
    (await stack.http(`/wagering/transactions/${won.body.transactionId}`)).body,
  ).toEqual(queried.body);

  const first = await stack.http<LedgerPage>(
    `/wallets/${wallet.id}/ledger?limit=2`,
  );
  expect(first.status).toBe(200);
  expect(first.body.items.map((item) => item.walletVersion)).toEqual([1, 2]);
  expect(first.body.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(
    (
      await stack.submit(
        command(wallet, {
          kind: 'WIN',
          money: { amount: '1.00', currency: 'BRL' },
        }),
      )
    ).status,
  ).toBe(201);
  const frozen = [...first.body.items];
  let cursor = first.body.nextCursor;
  while (cursor) {
    const page = await stack.http<LedgerPage>(
      `/wallets/${wallet.id}/ledger?limit=2&cursor=${cursor}`,
    );
    expect(page.status).toBe(200);
    frozen.push(...page.body.items);
    cursor = page.body.nextCursor;
  }
  expect(frozen.map((item) => item.walletVersion)).toEqual([1, 2, 3, 4, 5]);
  expect(new Set(frozen.map((item) => item.id)).size).toBe(5);
  const current = await stack.http<LedgerPage>(`/wallets/${wallet.id}/ledger`);
  expect(current.body.items.map((item) => item.walletVersion)).toEqual([
    1, 2, 3, 4, 5, 6,
  ]);
  expect(
    current.body.items.some((item) =>
      [lost.body.transactionId, rejected.body.transactionId].includes(
        item.transactionId,
      ),
    ),
  ).toBe(false);
  expect(await stack.counts(wallet.id)).toEqual({
    transactions: '8',
    receipts: '7',
    ledger: '6',
  });
  await stack.reconcile(wallet.id, '101.00', 6);
  await stack.events(wallet.id, {
    WagerTransactionProcessed: 7,
    WalletBalanceChanged: 6,
    WagerTransactionRejected: 1,
  });
}, 60000);

test('production consumer acknowledges duplicate SQS deliveries and separate message IDs with one financial effect', async () => {
  const wallet = await stack.open();
  const input = command(wallet);
  const first = stack.envelope(input);
  const second = { ...first, messageId: unique() };
  await stack.send(first);
  await stack.send(first);
  await stack.send(second);
  const applied = await until(
    () => stack.external(input),
    (result) => result.status === 200 && result.body.status === 'PROCESSED',
    'production consumer applies BET',
  );
  await until(
    () =>
      stack.read<{ message_id: string; processed: boolean }>(
        'select message_id,processed_at is not null as processed from inbox_messages where consumer_name=? and message_id in (?,?) order by message_id',
        ['wager-transactions-v1', first.messageId, second.messageId],
      ),
    (rows) => rows.length === 2 && rows.every((row) => row.processed),
    'two logical inbox identities complete for three deliveries',
  );
  await stack.sourceDrained();
  await stack.deadLettersEmpty();
  const replay = await stack.submit(input);
  expect(replay.status).toBe(200);
  expect(replay.body).toMatchObject({
    transactionId: applied.body.id,
    status: 'PROCESSED',
    balance: { amount: '75.00', currency: 'BRL' },
    idempotentReplay: true,
  });
  expect(await stack.counts(wallet.id)).toEqual({
    transactions: '2',
    receipts: '1',
    ledger: '2',
  });
  await stack.reconcile(wallet.id, '75.00', 2);
  await stack.events(wallet.id, {
    WagerTransactionProcessed: 2,
    WalletBalanceChanged: 2,
  });
}, 60000);

test.each([
  ['REFUND', 'HTTP'],
  ['REFUND', 'SQS'],
  ['ROLLBACK', 'HTTP'],
  ['ROLLBACK', 'SQS'],
] as const)(
  'production reference worker resolves %s arriving by %s before its BET',
  async (kind, transport) => {
    const wallet = await stack.open();
    const bet = command(wallet);
    const reversal = command(wallet, {
      kind,
      referenceExternalTransactionId: bet.externalTransactionId,
    });
    let original: Outcome;
    let inboxId: string;
    if (transport === 'HTTP') {
      const pending = await stack.submit(reversal);
      expect(pending.status).toBe(202);
      original = pending.body;
      const envelope = stack.envelope(bet);
      inboxId = envelope.messageId;
      await stack.send(envelope);
    } else {
      const envelope = stack.envelope(reversal);
      inboxId = envelope.messageId;
      await stack.send(envelope);
      const pending = await until(
        () => stack.external(reversal),
        (result) =>
          result.status === 200 && result.body.status === 'PENDING_REFERENCE',
        'SQS reversal is pending before BET exists',
      );
      const replay = await stack.submit(reversal);
      expect(replay.status).toBe(202);
      expect(replay.body.transactionId).toBe(pending.body.id);
      original = replay.body;
      expect((await stack.submit(bet)).status).toBe(201);
    }
    expect(original).toMatchObject({
      status: 'PENDING_REFERENCE',
      balance: { amount: '100.00', currency: 'BRL' },
      walletVersion: 1,
    });
    const resolved = await until(
      () => stack.external(reversal),
      (result) => result.status === 200 && result.body.status === 'PROCESSED',
      'production reference worker resolves late BET',
    );
    expect(resolved.body.id).toBe(original.transactionId);
    expect((await stack.external(bet)).body).toMatchObject({
      status: 'PROCESSED',
    });
    const replay = await stack.submit(reversal);
    expect(replay.status).toBe(202);
    expect(replay.body).toEqual({ ...original, idempotentReplay: true });
    const jobs = await stack.read<{ attempts: number; completed: boolean }>(
      'select attempts,completed_at is not null as completed from reference_jobs where transaction_id=?',
      [original.transactionId],
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.attempts).toBeGreaterThanOrEqual(1);
    expect(jobs[0]!.completed).toBe(true);
    expect(
      await stack.read<{ processed: boolean }>(
        'select processed_at is not null as processed from inbox_messages where consumer_name=? and message_id=?',
        ['wager-transactions-v1', inboxId],
      ),
    ).toEqual([{ processed: true }]);
    await stack.sourceDrained();
    expect(await stack.counts(wallet.id)).toEqual({
      transactions: '3',
      receipts: '2',
      ledger: '3',
    });
    await stack.reconcile(wallet.id, '100.00', 3);
    await stack.events(wallet.id, {
      WagerTransactionProcessed: 3,
      WalletBalanceChanged: 3,
      WagerTransactionPendingReference: 1,
    });
  },
  60000,
);
