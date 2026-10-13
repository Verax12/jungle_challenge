import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createApplication } from '../../src/composition/bootstrap.js';

let app: Awaited<ReturnType<typeof createApplication>>;
let url: string;

beforeAll(async () => {
  app = await createApplication(true);
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
});

test('NestJS serves public liveness without database or broker', async () => {
  const response = await fetch(`${url}/health/live`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('business endpoints are not installed by the foundation', async () => {
  const response = await fetch(`${url}/wallets`, { method: 'POST' });
  expect(response.status).toBe(404);
});

test('compiled entrypoint refuses invalid configuration and exits without leaking values', async () => {
  const child = Bun.spawn([process.execPath, 'dist/composition/main.js'], {
    env: {
      ...process.env,
      DB_PASSWORD: 'never-print-this',
      PORT: 'invalid-port',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode).toBe(1);
  expect(stderr).toContain('PORT');
  expect(stdout + stderr).not.toContain('never-print-this');
  expect(stdout + stderr).not.toContain('invalid-port');
});
