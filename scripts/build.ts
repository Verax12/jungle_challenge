import { rmSync } from 'node:fs';

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
process.exitCode = await Bun.spawn(
  [process.execPath, '--bun', 'tsc', '-p', 'tsconfig.build.json'],
  {
    stdout: 'inherit',
    stderr: 'inherit',
  },
).exited;
