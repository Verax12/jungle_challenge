import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const projectRoot = resolve(import.meta.dir, '../..');

export function fixture(): string {
  return mkdtempSync(join(tmpdir(), 'backend-harness-'));
}

export function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

export function remove(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

export function documentationFixture(): string {
  const root = fixture();
  for (const path of [
    'README.md',
    'AGENTS.md',
    'ARCHITECTURE.md',
    'docs',
    '.github',
    '.bun-version',
    'package.json',
  ]) {
    cpSync(join(projectRoot, path), join(root, path), { recursive: true });
  }
  return root;
}

export function editJson(
  root: string,
  path: string,
  edit: (value: Record<string, unknown>) => void,
): void {
  const value = JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<
    string,
    unknown
  >;
  edit(value);
  put(root, path, JSON.stringify(value));
}

export function cli(root: string, script: string) {
  return Bun.spawnSync(
    [process.execPath, join(projectRoot, 'scripts', script)],
    {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
}
