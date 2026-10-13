import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function checkToolchain(root: string, currentVersion: string): string[] {
  const expected = readFileSync(join(root, '.bun-version'), 'utf8').trim();
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    packageManager?: string;
    engines?: { bun?: string };
  };
  const errors: string[] = [];
  if (!/^1\.\d+\.\d+$/.test(expected))
    errors.push('.bun-version deve fixar uma versão Bun 1.x completa.');
  if (currentVersion !== expected)
    errors.push(`Bun ${currentVersion} diverge de .bun-version (${expected}).`);
  if (pkg.packageManager !== `bun@${expected}` || pkg.engines?.bun !== expected)
    errors.push(
      'packageManager e engines.bun devem corresponder a .bun-version.',
    );
  return errors;
}
