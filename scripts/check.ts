import { checkToolchain } from './lib/toolchain';

export const checks = [
  'check:docs',
  'check:architecture',
  'lint',
  'format:check',
  'typecheck',
  'build',
  'test:harness',
  'test:app',
] as const;

export async function runChecks(
  run: (name: string) => Promise<number>,
): Promise<number> {
  let failed = false;
  for (const name of checks) {
    if ((await run(name)) !== 0) failed = true;
  }
  return failed ? 1 : 0;
}

if (import.meta.main) {
  const toolchainErrors = checkToolchain(process.cwd(), Bun.version);
  for (const error of toolchainErrors) console.error(`[toolchain] ${error}`);
  const result = await runChecks(async (name) => {
    console.log(`\n[check] ${name}`);
    return await Bun.spawn([process.execPath, 'run', name], {
      stdout: 'inherit',
      stderr: 'inherit',
    }).exited;
  });
  process.exitCode = toolchainErrors.length ? 1 : result;
}
