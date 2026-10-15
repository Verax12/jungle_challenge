import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { loadConfig } from '../../src/adapters/config/environment.js';
import {
  createLocalSqsClient,
  queueUrls,
} from '../../src/adapters/messaging/local-sqs.js';
import { consumerName } from '../../src/adapters/messaging/request-contract.js';
import { connectDatabase } from '../../src/adapters/persistence/database.js';

const project = process.env.COMPOSE_PROJECT_NAME ?? '';
const base = process.env.AUDIT_APP_URL ?? '';
assert(
  /^backend-challenge-t13-[a-z0-9-]+$/.test(project),
  'Use an exclusive T13 Compose project',
);
assert(
  /^http:\/\/127\.0\.0\.1:\d+$/.test(base),
  'AUDIT_APP_URL must be loopback',
);
const config = loadConfig({
  ...process.env,
  DB_PORT: process.env.DB_PORT ?? '15443',
});
assert(['localhost', '127.0.0.1'].includes(config.database.host));
assert.equal(
  config.database.port,
  15443,
  'Use the exclusive T13 database port',
);
const sqsEndpoint = new URL(config.sqs.endpoint);
assert(['localhost', '127.0.0.1'].includes(sqsEndpoint.hostname));
const started = new Date().toISOString();
const report = (scenario: string, facts: Record<string, unknown>) =>
  console.log(JSON.stringify({ scenario, ...facts }));

async function command(args: string[]) {
  const child = Bun.spawn(['docker', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 70000,
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
type Container = {
  id: string;
  state: {
    Running: boolean;
    ExitCode: number;
    OOMKilled: boolean;
    StartedAt: string;
    FinishedAt: string;
  };
  labels: Record<string, string>;
  ports: Record<string, { HostIp: string; HostPort: string }[] | null>;
  networks: Record<string, { IPAddress: string }>;
};
async function inspect(id: string): Promise<Container> {
  return JSON.parse(
    await command([
      'inspect',
      '--format',
      '{"id":{{json .Id}},"state":{{json .State}},"labels":{{json .Config.Labels}},"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}',
      id,
    ]),
  ) as Container;
}
async function service(name: string) {
  const id = await compose('ps', '-q', name);
  assert(/^[a-f0-9]{12,64}$/.test(id), `Expected one running ${name}`);
  const container = await inspect(id);
  assert.equal(container.labels['com.docker.compose.project'], project);
  assert.equal(container.labels['com.docker.compose.service'], name);
  assert(container.state.Running, `${name} must be running`);
  return container;
}
function mappedPort(container: Container, port: string, hostPort: string) {
  assert(
    container.ports[port]?.some(
      (mapping) =>
        mapping.HostIp === '127.0.0.1' && mapping.HostPort === hostPort,
    ),
    `${port} must map to the configured loopback port in the audit project`,
  );
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
  interval = 150,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accepts(value)) return value;
    await Bun.sleep(interval);
  }
  throw new Error(`Timeout: ${label}`);
}
type Money = { amount: string; currency: string };
type Wallet = { id: string; playerId: string; balance: Money; version: number };
type Outcome = {
  transactionId: string;
  status: string;
  balance: Money;
  idempotentReplay: boolean;
};
type Blocked = { pid: number; client_addr: string; wait_ms: string };
type KillEvent = {
  Action?: string;
  Actor?: { Attributes?: { signal?: string } };
};

const [consumer, app, postgres, localstack] = await Promise.all([
  service('consumer'),
  service('app'),
  service('postgres'),
  service('localstack'),
]);
mappedPort(app, '3000/tcp', new URL(base).port);
mappedPort(postgres, '5432/tcp', String(config.database.port));
mappedPort(localstack, '4566/tcp', sqsEndpoint.port || '80');
const consumerAddresses = Object.values(consumer.networks).map(
  (network) => network.IPAddress,
);
const orm = await connectDatabase(config.database);
const client = createLocalSqsClient(config.sqs);
const holder = orm.em.fork();
const sql = <T>(query: string, params: unknown[] = []) =>
  orm.em.getConnection().execute<T[]>(query, params);
let lockHeld = false;
let restartNeeded = false;
let stopping: Promise<string> | undefined;
let stopError: unknown;
let signalSeen = false;
let watcherError: unknown;
const watcher = Bun.spawn(
  [
    'docker',
    'events',
    '--since',
    started,
    '--filter',
    `container=${consumer.id}`,
    '--filter',
    'event=kill',
    '--format',
    '{{json .}}',
  ],
  { stdout: 'pipe', stderr: 'pipe' },
);
const watcherErrors = new Response(watcher.stderr).text();
const watching = (async () => {
  const reader = watcher.stdout.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const event = JSON.parse(pending.slice(0, newline)) as KillEvent;
        pending = pending.slice(newline + 1);
        if (event.Action === 'kill' && event.Actor?.Attributes?.signal === '15')
          signalSeen = true;
      }
    }
  } catch (error) {
    watcherError = error;
  } finally {
    reader.releaseLock();
  }
})();
async function release() {
  if (lockHeld) {
    await holder.rollback();
    lockHeld = false;
  }
}
async function restart() {
  await compose('up', '-d', '--wait', '--no-build', '--no-deps', 'consumer');
  restartNeeded = false;
}
async function logs(messageId: string) {
  const output = await compose(
    'logs',
    '--no-color',
    '--since',
    started,
    'consumer',
  );
  return output.split('\n').flatMap((line) => {
    const json = line.indexOf('{');
    if (json === -1) return [];
    try {
      const event = JSON.parse(line.slice(json)) as Record<string, unknown>;
      return event.messageId === messageId ? [event] : [];
    } catch {
      return [];
    }
  });
}

try {
  const urls = await queueUrls(client);
  assert.equal((await http('/health/ready')).status, 200);
  const opened = await http<Wallet>('/wallets', {
    playerId: randomUUID(),
    initialBalance: { amount: '100.00', currency: 'BRL' },
  });
  assert.equal(opened.status, 201);
  const wallet = opened.body;
  const idempotencyKey = randomUUID();
  const request = {
    providerId: 'audit-shutdown',
    externalTransactionId: randomUUID(),
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: randomUUID(),
    gameId: 'audit',
    kind: 'BET',
    money: { amount: '25.00', currency: 'BRL' },
  };
  const envelope = {
    messageId: randomUUID(),
    type: 'WagerTransactionRequested',
    occurredAt: new Date().toISOString(),
    data: { ...request, idempotencyKey },
  };
  const send = () =>
    client.send(
      new SendMessageCommand({
        QueueUrl: urls.transactions,
        MessageBody: JSON.stringify(envelope),
        MessageGroupId: wallet.id,
        MessageDeduplicationId: randomUUID(),
      }),
    );

  await holder.begin();
  lockHeld = true;
  const connection = holder.getConnection();
  const context = holder.getTransactionContext();
  const [lock] = await connection.execute<{ pid: number }[]>(
    'select pg_backend_pid() as pid from wallets where id = ? for update',
    [wallet.id],
    'all',
    context,
  );
  assert(lock);
  const blocked = () =>
    sql<Blocked>(
      `select a.pid, host(a.client_addr) as client_addr, (extract(epoch from (clock_timestamp()-a.query_start))*1000)::text as wait_ms
     from pg_stat_activity a where ? = any(pg_blocking_pids(a.pid))
     and a.wait_event_type = 'Lock' and a.query ilike '%wallets%'`,
      [lock.pid],
    );
  await send();
  const waiting = await until(
    blocked,
    (rows) => rows.length === 1,
    'production consumer blocked before commit',
    15000,
    10,
  );
  assert(consumerAddresses.includes(waiting[0]!.client_addr));
  restartNeeded = true;
  stopping = compose('stop', '-t', '60', 'consumer').catch((error: unknown) => {
    stopError = error;
    return '';
  });
  await until(
    async () => {
      if (watcherError) throw watcherError;
      if (stopError) throw stopError;
      return signalSeen;
    },
    Boolean,
    'Docker delivered SIGTERM while the wallet remained locked',
    1200,
    5,
  );
  const beforeCommit = await blocked();
  assert.equal(
    beforeCommit.length,
    1,
    'Consumer must still be blocked after SIGTERM',
  );
  assert.equal(beforeCommit[0]!.pid, waiting[0]!.pid);
  const [uncommitted] = await sql<{
    transactions: string;
    receipts: string;
    inbox: string;
  }>(
    `select
       (select count(*)::text from wager_transactions where provider_id=? and external_transaction_id=?) as transactions,
       (select count(*)::text from processing_receipts where idempotency_key=?) as receipts,
       (select count(*)::text from inbox_messages where consumer_name=? and message_id=?) as inbox`,
    [
      request.providerId,
      request.externalTransactionId,
      idempotencyKey,
      consumerName,
      envelope.messageId,
    ],
  );
  assert.deepEqual(uncommitted, {
    transactions: '0',
    receipts: '0',
    inbox: '0',
  });
  await release();
  await stopping;
  if (stopError) throw stopError;
  const stopped = await inspect(consumer.id);
  assert.equal(stopped.state.Running, false);
  assert.equal(stopped.state.ExitCode, 0, 'SIGTERM must exit gracefully');
  assert.equal(stopped.state.OOMKilled, false);
  assert.equal(
    stopped.state.StartedAt,
    consumer.state.StartedAt,
    'No automatic restart during the probe',
  );
  const firstLogs = await logs(envelope.messageId);
  assert.equal(
    firstLogs.filter(
      (event) =>
        event.event === 'message_committed' && event.idempotentReplay === false,
    ).length,
    1,
  );
  assert(
    !firstLogs.some((event) =>
      ['message_retry', 'message_dead_lettered'].includes(String(event.event)),
    ),
  );
  const afterStop = await http<Wallet>(`/wallets/${wallet.id}`);
  assert.equal(afterStop.status, 200);
  assert.equal(afterStop.body.balance.amount, '75.00');
  assert.equal(afterStop.body.version, 2);
  report('sigterm-before-commit', {
    walletId: wallet.id,
    holderPid: lock.pid,
    consumerBackendPid: beforeCommit[0]!.pid,
    signalObservedWhileBlocked: true,
    waitMillisecondsAtSignal: beforeCommit[0]!.wait_ms,
    visibleBeforeUnlock: uncommitted,
    exitCode: stopped.state.ExitCode,
    stoppedAt: stopped.state.FinishedAt,
    balance: '75.00',
    committedAndAcknowledgedBeforeExit: true,
  });

  await restart();
  const resumed = await service('consumer');
  assert.notEqual(resumed.state.StartedAt, consumer.state.StartedAt);
  await send();
  await until(
    () => logs(envelope.messageId),
    (events) =>
      events.some(
        (event) =>
          event.event === 'message_committed' &&
          event.idempotentReplay === true,
      ),
    'production consumer acknowledges duplicate after restart',
  );
  const replay = await http<Outcome>(
    '/wagering/transactions',
    request,
    idempotencyKey,
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.body.status, 'PROCESSED');
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(replay.body.balance.amount, '75.00');
  const [counts] = await sql<{
    transactions: string;
    receipts: string;
    inbox: string;
    ledger: string;
    processed_inbox: boolean;
  }>(
    `select
       (select count(*)::text from wager_transactions where provider_id=? and external_transaction_id=?) as transactions,
       (select count(*)::text from processing_receipts where idempotency_key=?) as receipts,
       (select count(*)::text from inbox_messages where consumer_name=? and message_id=?) as inbox,
       (select count(*)::text from wallet_ledger_entries where wallet_id=?) as ledger,
       (select processed_at is not null from inbox_messages where consumer_name=? and message_id=?) as processed_inbox`,
    [
      request.providerId,
      request.externalTransactionId,
      idempotencyKey,
      consumerName,
      envelope.messageId,
      wallet.id,
      consumerName,
      envelope.messageId,
    ],
  );
  assert.deepEqual(counts, {
    transactions: '1',
    receipts: '1',
    inbox: '1',
    ledger: '2',
    processed_inbox: true,
  });
  const events = await until(
    () =>
      sql<{ id: string; published: boolean }>(
        "select id, published_at is not null as published from outbox_messages where payload->'data'->>'walletId'=? order by id",
        [wallet.id],
      ),
    (rows) => rows.length === 4 && rows.every((row) => row.published),
    'opening and BET outbox events published',
  );
  const reconciliation = await http<{
    consistent: boolean;
    storedBalance: Money;
    calculatedBalance: Money;
    checkedEntries: number;
  }>(`/wallets/${wallet.id}/reconciliation`, {});
  assert.equal(reconciliation.status, 200);
  assert.equal(reconciliation.body.consistent, true);
  assert.equal(reconciliation.body.storedBalance.amount, '75.00');
  assert.equal(reconciliation.body.calculatedBalance.amount, '75.00');
  assert.equal(reconciliation.body.checkedEntries, 2);
  assert.equal((await http('/health/ready')).status, 200);
  report('sigterm-restart-replay', {
    walletId: wallet.id,
    transactionId: replay.body.transactionId,
    ...counts,
    balance: '75.00',
    reconciled: true,
    duplicateAcknowledged: true,
    outboxPublishedIds: events.map((event) => event.id),
    elapsedSeconds: (Date.now() - Date.parse(started)) / 1000,
  });
} finally {
  const cleanupErrors: unknown[] = [];
  for (const cleanup of [
    release,
    () => orm.close(true),
    async () => {
      client.destroy();
      watcher.kill();
      await watching;
      await watcher.exited;
      const errors = await watcherErrors;
      if (watcherError)
        report('docker-event-observer-error', {
          error: String(watcherError),
          detail: errors,
        });
    },
    async () => {
      if (stopping) await stopping;
    },
    async () => {
      if (restartNeeded) await restart();
    },
  ]) {
    try {
      await cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length) {
    report('shutdown-probe-cleanup-failed', {
      errors: cleanupErrors.map((error) => String(error)),
    });
    process.exitCode = 1;
  }
}
