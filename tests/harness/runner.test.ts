import { afterEach, expect, test } from 'bun:test';
import { checks, runChecks } from '../../scripts/check';
import { diagnoseCommand, versionMatches } from '../../scripts/doctor';
import { checkToolchain } from '../../scripts/lib/toolchain';
import { fixture, put, remove } from './helpers';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) remove(root);
});

test('runner executes all checks and preserves any failure', async () => {
  const executed: string[] = [];
  const result = await runChecks(async (name) => {
    executed.push(name);
    return name === 'check:docs' ? 1 : 0;
  });
  expect(executed).toEqual([...checks]);
  expect(result).toBe(1);
});

test('runner succeeds only when every check succeeds', async () => {
  expect(await runChecks(async () => 0)).toBe(0);
});

test('doctor requires the pinned runtime version', () => {
  expect(versionMatches('1.4.3', '1.4.3\n')).toBe(true);
  expect(versionMatches('1.4.2', '1.4.3')).toBe(false);
});

test('doctor reports missing and failed commands without crashing', () => {
  expect(diagnoseCommand(['backend-harness-command-does-not-exist']).ok).toBe(
    false,
  );
  expect(diagnoseCommand([process.execPath, '-e', 'process.exit(2)']).ok).toBe(
    false,
  );
  expect(diagnoseCommand([process.execPath, '--version']).ok).toBe(true);
});

test('toolchain metadata and runtime must match the same Bun 1.x version', () => {
  const root = fixture();
  roots.push(root);
  put(root, '.bun-version', '1.4.3\n');
  put(
    root,
    'package.json',
    JSON.stringify({ packageManager: 'bun@1.4.3', engines: { bun: '1.4.3' } }),
  );
  expect(checkToolchain(root, '1.4.3')).toEqual([]);
  expect(checkToolchain(root, '1.4.2').join('\n')).toContain('diverge');
  put(root, 'package.json', JSON.stringify({ packageManager: 'bun@1.4.2' }));
  expect(checkToolchain(root, '1.4.3').join('\n')).toContain('packageManager');
});
