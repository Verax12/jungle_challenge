import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ignored = new Set(['.git', 'node_modules', 'coverage', 'dist', '.cache']);

export function filesUnder(root: string, extension?: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) return [];
      const path = join(root, entry.name);
      if (entry.isDirectory()) return filesUnder(path, extension);
      return entry.isFile() && (!extension || path.endsWith(extension))
        ? [path]
        : [];
    })
    .sort();
}

export function relativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

export function inside(root: string, path: string): boolean {
  const local = relative(root, path);
  return (
    local === '' ||
    (!local.startsWith(`..${sep}`) && local !== '..' && !local.startsWith(sep))
  );
}

export function report(
  name: string,
  errors: string[],
  success: string,
): number {
  if (errors.length) {
    for (const error of errors) console.error(`[${name}] ${error}`);
    return 1;
  }
  console.log(`[${name}] ${success}`);
  return 0;
}
