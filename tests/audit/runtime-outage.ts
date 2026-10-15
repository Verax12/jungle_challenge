import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const project = process.env.COMPOSE_PROJECT_NAME ?? '';
const base = process.env.AUDIT_APP_URL ?? '';
assert(
  /^backend-challenge-t(?:11|13)-[a-z0-9-]+$/.test(project),
  'Use an exclusive T11 or T13 Compose project',
);
assert(
  /^http:\/\/127\.0\.0\.1:\d+$/.test(base),
  'AUDIT_APP_URL must be loopback',
);
const started = Date.now();
const paused = new Set<string>();
const postgresMode = process.env.AUDIT_POSTGRES_MODE ?? 'pause';
assert(['pause', 'stop'].includes(postgresMode));
let postgresStopped = false;
const report = (scenario: string, facts: Record<string, unknown>) =>
  console.log(JSON.stringify({ scenario, ...facts }));

async function command(args: string[]) {
  const child = Bun.spawn(['docker', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 60000,
  });
  const [output, errors, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(code, 0, errors);
  return output.trim();
}
const compose = (...args: string[]) => command(['compose', ...args]);
const sql = (query: string) =>
  compose(
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'wagering',
    '-d',
    'wagering',
    '-Atc',
    query,
  );
async function sqs<T>(...args: string[]): Promise<T> {
  const value = await compose(
    'exec',
    '-T',
    'localstack',
    'awslocal',
    'sqs',
    ...args,
  );
  return JSON.parse(value || '{}') as T;
}
async function http<T>(path: string, body?: unknown, key?: string) {
  const response = await fetch(base + path, {
    ...(body === undefined
      ? {}
      : { method: 'POST', body: JSON.stringify(body) }),
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    signal: AbortSignal.timeout(7000),
  });
  return { status: response.status, body: (await response.json()) as T };
}
async function until<T>(
  read: () => Promise<T>,
  accepts: (result: T) => boolean,
  label: string,
  timeout = 45000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read();
    if (accepts(result)) return result;
    await Bun.sleep(150);
  }
  throw new Error(`Timeout: ${label}`);
}
async function pause(service: string) {
  await compose('pause', service);
  paused.add(service);
}
async function resume(service: string) {
  await compose('unpause', service);
  paused.delete(service);
}
async function processes() {
  const ids = (
    await compose(
      'ps',
      '-q',
      'app',
      'consumer',
      'publisher',
      'reference-worker',
    )
  ).split('\n');
  assert.equal(ids.length, 4);
  return command([
    'inspect',
    '--format',
    '{{.Name}} {{.State.Pid}} {{.State.StartedAt}}',
    ...ids,
  ]);
}
type Balance = { amount: string; currency: string };
type Wallet = {
  id: string;
  playerId: string;
  balance: Balance;
  version: number;
};
type Outcome = {
  transactionId: string;
  status: string;
  balance: Balance;
  idempotentReplay: boolean;
};
type Readiness = { checks: { postgres: string; sqs: string } };
try {
  const appId = await compose('ps', '-q', 'app');
  assert(/^[a-f0-9]{12,64}$/.test(appId), 'Expected one running application');
  const app = JSON.parse(
    await command([
      'inspect',
      '--format',
      '{"labels":{{json .Config.Labels}},"ports":{{json .NetworkSettings.Ports}}}',
      appId,
    ]),
  ) as {
    labels: Record<string, string>;
    ports: Record<string, { HostIp: string; HostPort: string }[]>;
  };
  assert.equal(app.labels['com.docker.compose.project'], project);
  assert.equal(app.labels['com.docker.compose.service'], 'app');
  assert(
    app.ports['3000/tcp']?.some(
      (mapping) =>
        mapping.HostIp === '127.0.0.1' &&
        mapping.HostPort === new URL(base).port,
    ),
    'AUDIT_APP_URL must match the exclusive project application port',
  );
  assert.equal(
    await sql('select count(*) from wallets'),
    '0',
    'Use a new empty audit database',
  );
  const initialProcesses = await processes();
  const opened = await http<Wallet>('/wallets', {
    playerId: randomUUID(),
    initialBalance: { amount: '100.00', currency: 'BRL' },
  });
  assert.equal(opened.status, 201);
  const w = opened.body;
  const request = {
    providerId: 'audit',
    playerId: w.playerId,
    walletId: w.id,
    roundId: randomUUID(),
    gameId: 'audit',
    kind: 'BET',
    money: { amount: '25.00', currency: 'BRL' },
    externalTransactionId: randomUUID(),
  };
  await until(
    () =>
      sql('select count(*) from outbox_messages where published_at is null'),
    (value) => value === '0',
    'opening published',
  );

  await pause('localstack');
  const sqsDown = await http<Readiness>('/health/ready');
  assert.equal(sqsDown.status, 503);
  assert.equal(sqsDown.body.checks.sqs, 'down');
  assert.equal((await http('/health/live')).status, 200);
  const result = await http<Outcome>(
    '/wagering/transactions',
    request,
    request.externalTransactionId,
  );
  assert.equal(result.status, 201);
  assert.equal(result.body.balance.amount, '75.00');
  assert.equal(
    await sql(
      'select count(*) from outbox_messages where published_at is null',
    ),
    '2',
  );
  await until(
    () =>
      sql(
        'select count(*) from outbox_messages where attempts>0 and published_at is null',
      ),
    (value) => value !== '0',
    'SQS timeout schedules persistent retry',
    45000,
  );
  await resume('localstack');
  await until(
    () =>
      sql('select count(*) from outbox_messages where published_at is null'),
    (value) => value === '0',
    'publisher recovers after SQS returns',
  );
  assert.equal((await http('/health/ready')).status, 200);
  assert.equal(await sql('select count(*) from outbox_messages'), '4');
  report('sqs-outage-recovery', {
    readinessDuringOutage: 503,
    livenessDuringOutage: 200,
    financialCommit: 201,
    balance: '75.00',
    eventsPreservedAndPublished: 4,
    retryObserved: true,
  });

  const queue = (
    await sqs<{ QueueUrl: string }>(
      'get-queue-url',
      '--queue-name',
      'wager-transactions.fifo',
    )
  ).QueueUrl;
  if (postgresMode === 'stop') {
    const barrier = {
      messageId: randomUUID(),
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: { ...request, idempotencyKey: request.externalTransactionId },
    };
    await sqs(
      'send-message',
      '--queue-url',
      queue,
      '--message-body',
      JSON.stringify(barrier),
      '--message-group-id',
      w.id,
      '--message-deduplication-id',
      randomUUID(),
    );
    await until(
      () =>
        sql(
          'select count(*) from inbox_messages where processed_at is not null',
        ),
      (value) => value === '1',
      'consumer resumed polling after the SQS outage',
    );
  }
  const envelope = {
    messageId: randomUUID(),
    type: 'WagerTransactionRequested',
    occurredAt: new Date().toISOString(),
    data: {
      ...request,
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      kind: 'WIN',
      money: { amount: '10.00', currency: 'BRL' },
      referenceExternalTransactionId: request.externalTransactionId,
    },
  };
  if (postgresMode === 'stop') {
    await compose('stop', 'postgres');
    postgresStopped = true;
  } else {
    await pause('postgres');
  }
  const pgDown = await http<Readiness>('/health/ready');
  assert.equal(pgDown.status, 503);
  assert.equal(pgDown.body.checks.postgres, 'down');
  assert.equal((await http('/health/live')).status, 200);
  await sqs(
    'send-message',
    '--queue-url',
    queue,
    '--message-body',
    JSON.stringify(envelope),
    '--message-group-id',
    w.id,
    '--message-deduplication-id',
    randomUUID(),
  );
  if (postgresMode === 'stop') {
    await until(
      () => compose('logs', '--no-color', '--tail', '100', 'consumer'),
      (value) =>
        value
          .split('\n')
          .some(
            (line) =>
              line.includes('"event":"message_retry"') &&
              line.includes(`"messageId":"${envelope.messageId}"`),
          ),
      'consumer retries while PostgreSQL is stopped',
      10000,
    );
    await compose('up', '-d', '--wait', '--no-build', 'postgres');
    postgresStopped = false;
  } else {
    await until(
      () =>
        sqs<{ Attributes: Record<string, string> }>(
          'get-queue-attributes',
          '--queue-url',
          queue,
          '--attribute-names',
          'ApproximateNumberOfMessagesNotVisible',
        ),
      (value) => value.Attributes.ApproximateNumberOfMessagesNotVisible === '1',
      'consumer received while PostgreSQL paused',
      10000,
    );
    await resume('postgres');
  }
  await until(
    () => http<Wallet>(`/wallets/${w.id}`),
    (value) => value.status === 200 && value.body.balance.amount === '85.00',
    'consumer recovers after PostgreSQL returns',
  );
  await sqs(
    'send-message',
    '--queue-url',
    queue,
    '--message-body',
    JSON.stringify(envelope),
    '--message-group-id',
    w.id,
    '--message-deduplication-id',
    randomUUID(),
  );
  await until(
    () =>
      sqs<{ Attributes: Record<string, string> }>(
        'get-queue-attributes',
        '--queue-url',
        queue,
        '--attribute-names',
        'ApproximateNumberOfMessages',
        'ApproximateNumberOfMessagesNotVisible',
      ),
    (value) => Object.values(value.Attributes).every((count) => count === '0'),
    'duplicate acknowledged',
  );
  await until(
    () =>
      compose(
        'exec',
        '-T',
        'consumer',
        'bun',
        '-e',
        "const r=await fetch('http://127.0.0.1:9464/metrics');if(!r.ok)process.exit(1);console.log(await r.text())",
      ),
    (value) => {
      const count = value.match(
        /^wagering_duplicates_total\{source="sqs"\} (\d+)$/m,
      )?.[1];
      return Number(count ?? 0) >= (postgresMode === 'stop' ? 2 : 1);
    },
    'duplicate replay observed by production consumer',
  );
  await until(
    () =>
      sql('select count(*) from outbox_messages where published_at is null'),
    (value) => value === '0',
    'all outbox published',
  );
  const expectedInbox = postgresMode === 'stop' ? 2 : 1;
  assert.equal(
    await sql('select count(*) from inbox_messages'),
    String(expectedInbox),
  );
  assert.equal(await sql('select count(*) from processing_receipts'), '2');
  assert.equal(await sql('select count(*) from wallet_ledger_entries'), '3');
  const reconciliation = await http<{
    consistent: boolean;
    storedBalance: Balance;
    checkedEntries: number;
  }>(`/wallets/${w.id}/reconciliation`, {});
  assert.equal(reconciliation.body.consistent, true);
  assert.equal(reconciliation.body.storedBalance.amount, '85.00');
  assert.equal(reconciliation.body.checkedEntries, 3);
  const replay = await http<Outcome>(
    '/wagering/transactions',
    request,
    request.externalTransactionId,
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.body.balance.amount, '75.00');
  assert.equal(replay.body.transactionId, result.body.transactionId);
  assert.equal(
    await processes(),
    initialProcesses,
    'Recovery must use the same production processes',
  );
  const eventsQueue = (
    await sqs<{ QueueUrl: string }>(
      'get-queue-url',
      '--queue-name',
      'wager-events.fifo',
    )
  ).QueueUrl;
  const expected = (
    await sql('select id from outbox_messages order by id')
  ).split('\n');
  assert.equal(expected.length, 6);
  const seen = new Set<string>();
  await until(
    async () => {
      const batch = await sqs<{
        Messages?: { Body: string; ReceiptHandle: string }[];
      }>(
        'receive-message',
        '--queue-url',
        eventsQueue,
        '--max-number-of-messages',
        '10',
        '--wait-time-seconds',
        '1',
      );
      for (const item of batch.Messages ?? []) {
        seen.add((JSON.parse(item.Body) as { eventId: string }).eventId);
        await sqs(
          'delete-message',
          '--queue-url',
          eventsQueue,
          '--receipt-handle',
          item.ReceiptHandle,
        );
      }
      return seen.size;
    },
    (count) => count === expected.length,
    'all committed event IDs received',
  );
  assert.deepEqual([...seen].sort(), expected);
  const dlq = (
    await sqs<{ QueueUrl: string }>(
      'get-queue-url',
      '--queue-name',
      'wager-transactions-dlq.fifo',
    )
  ).QueueUrl;
  const attrs = await sqs<{ Attributes: Record<string, string> }>(
    'get-queue-attributes',
    '--queue-url',
    dlq,
    '--attribute-names',
    'ApproximateNumberOfMessages',
    'ApproximateNumberOfMessagesNotVisible',
  );
  assert(Object.values(attrs.Attributes).every((value) => value === '0'));
  assert.equal((await http('/health/ready')).status, 200);
  report('postgres-outage-recovery', {
    readinessDuringOutage: 503,
    livenessDuringOutage: 200,
    inbox: expectedInbox,
    receipts: 2,
    ledger: 3,
    balance: '85.00',
    reconciled: true,
    eventIdsReceived: seen.size,
    dlq: 0,
    sameProductionProcesses: true,
    postgresMode,
    deliveryReceivedDuringPostgresPause: postgresMode === 'pause',
    postgresRetryObserved: postgresMode === 'stop',
    elapsedSeconds: (Date.now() - started) / 1000,
  });
} finally {
  for (const service of paused) await resume(service);
  if (postgresStopped)
    await compose('up', '-d', '--wait', '--no-build', 'postgres');
}
