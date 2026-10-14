import { expect } from 'bun:test';
import type { fixture } from '../messaging/helpers.js';
import { loadConfig } from '../../src/adapters/config/environment.js';
import { processSource } from './process-source.js';
import { sql } from '../persistence/helpers.js';
import { MikroFinancialQueries } from '../../src/adapters/persistence/financial-queries.js';
export type Fixture = Awaited<ReturnType<typeof fixture>>;
export interface Event {
  event: string;
  pid: number;
  dbPid?: number;
  url?: string;
  point?: string;
  receipt?: string;
  eventId?: string;
  transactionId?: string;
  messageId?: string;
  status?: string;
  code?: string;
  idempotentReplay?: boolean;
}
export async function until<T>(
  read: () => Promise<T> | T,
  accept: (value: T) => boolean,
  description: string,
  timeout = 10000,
): Promise<T> {
  const expires = Date.now() + timeout;
  while (Date.now() < expires) {
    const value = await read();
    if (accept(value)) return value;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out: ${description}`);
}
export function child(
  f: Fixture,
  mode: 'api' | 'consumer' | 'publisher' | 'references',
  gate = '',
) {
  const events: Event[] = [];
  const config = loadConfig(process.env).database;
  const processHandle = Bun.spawn([process.execPath, '--eval', processSource], {
    env: {
      ...process.env,
      DB_NAME: f.name,
      DB_HOST: config.host,
      DB_PORT: String(config.port),
      DB_USER: config.user,
      DB_PASSWORD: config.password,
      TASK_PROCESS_MODE: mode,
      TASK_GATE: gate,
      TASK_QUEUE_URLS: JSON.stringify(f.urls),
    },
    ipc(message: unknown) {
      events.push(message as Event);
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = new Response(processHandle.stdout).text(),
    stderr = new Response(processHandle.stderr).text();
  const ready = until(
    () => {
      const fatal = events.find((e) => e.event === 'fatal');
      if (fatal) throw new Error(JSON.stringify(fatal));
      if (processHandle.exitCode !== null)
        throw new Error(`Child exited before ready: ${processHandle.exitCode}`);
      return events.find((e) => e.event === 'ready');
    },
    (r) => !!r,
    `${mode} ready PID ${processHandle.pid}`,
  );
  return {
    process: processHandle,
    events,
    ready,
    async wait(event: string) {
      try {
        return await until(
          () => {
            const result = events.find((e) => e.event === event);
            if (result) return result;
            const fatal = events.find((e) => e.event === 'fatal');
            if (fatal) throw new Error(JSON.stringify(fatal));
            if (processHandle.exitCode !== null)
              throw new Error(
                `Child exited while waiting: ${processHandle.exitCode}`,
              );
            return undefined;
          },
          (r) => !!r,
          `${event} from PID ${processHandle.pid}`,
        );
      } catch (error) {
        throw new Error(
          `${String(error)}; events=${JSON.stringify(events.map(({ event, status, code }) => ({ event, status, code })))}`,
        );
      }
    },
    start() {
      processHandle.send('start');
    },
    release() {
      processHandle.send('release');
    },
    async stop(signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM') {
      if (processHandle.exitCode === null) processHandle.kill(signal);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          processHandle.exited,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              processHandle.kill('SIGKILL');
              reject(new Error('Child shutdown timeout'));
            }, 5000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        await processHandle.exited;
        await Promise.all([stdout, stderr]);
      }
    },
  };
}
export type Child = ReturnType<typeof child>;
export async function stopAll(children: Child[]) {
  const results = await Promise.allSettled(children.map((c) => c.stop()));
  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  );
  if (failures.length)
    throw new AggregateError(
      failures.map((r) => r.reason),
      'Failed to stop test processes',
    );
}
export async function cluster(
  f: Fixture,
  children: Child[],
  mode: Parameters<typeof child>[1],
  count: number,
  gate = '',
) {
  const group = Array.from({ length: count }, () => child(f, mode, gate));
  children.push(...group);
  const readiness = await Promise.all(group.map((c) => c.ready));
  expect(new Set(group.map((c) => c.process.pid)).size).toBe(count);
  expect(new Set(readiness.map((e) => e!.dbPid)).size).toBe(count);
  expect(group.every((c) => c.process.exitCode === null)).toBe(true);
  console.log(
    JSON.stringify({
      scenarioProcesses: mode,
      pids: group.map((c) => c.process.pid),
      databasePids: readiness.map((e) => e!.dbPid),
    }),
  );
  return group;
}
export async function call(
  api: Child,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const { url } = (await api.ready)!;
  const response = await fetch(`${url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}
export function submit(api: Child, body: { data: Record<string, unknown> }) {
  const { idempotencyKey, ...payload } = body.data;
  return call(api, '/wagering/transactions', payload, {
    'Idempotency-Key': String(idempotencyKey),
  });
}
export async function reconcile(f: Fixture, walletId: string, amount: string) {
  const r = await new MikroFinancialQueries(f.orm).reconciliation(walletId);
  expect(r.consistent).toBe(true);
  expect(r.storedBalance.amount).toBe(amount);
  expect(r.difference.amount).toBe('0.00');
  return r;
}
export async function blockedBy(
  f: Fixture,
  controlPid: number,
  requiredPids: number[],
) {
  return until(
    async () => {
      const rows = (await sql(
        f.orm.em.fork(),
        `with recursive blocked(pid) as (
      select ?::integer union select a.pid from pg_stat_activity a join blocked b on b.pid=any(pg_blocking_pids(a.pid))
    ) select pid from blocked where pid<>?`,
        [controlPid, controlPid],
      )) as { pid: number }[];
      return rows.map((r) => r.pid);
    },
    (pids) => requiredPids.every((pid) => pids.includes(pid)),
    'independent processes blocked on wallet',
  );
}
export async function holdWallet(f: Fixture, walletId: string) {
  const acquired = Promise.withResolvers<number>(),
    gate = Promise.withResolvers<void>();
  const transaction = f.orm.em.fork().transactional(async (em) => {
    const [row] = (await sql(
      em,
      'select pg_backend_pid() as pid from wallets where id=? for update',
      [walletId],
    )) as { pid: number }[];
    acquired.resolve(row!.pid);
    await gate.promise;
  });
  void transaction.catch(acquired.reject);
  return {
    pid: await acquired.promise,
    async release() {
      gate.resolve();
      await transaction;
    },
  };
}
