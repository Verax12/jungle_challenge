import { readFileSync } from 'node:fs';

export function versionMatches(actual: string, expected: string): boolean {
  return actual.trim() === expected.trim();
}

export function diagnoseCommand(command: readonly string[]): {
  ok: boolean;
  detail: string;
} {
  try {
    const result = Bun.spawnSync([...command], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 10_000,
    });
    if (result.exitCode === 0)
      return { ok: true, detail: result.stdout.toString().trim() };
  } catch {
    // Missing executables are an expected diagnostic, not a fatal exception.
  }
  return {
    ok: false,
    detail: 'indisponível; consulte docs/runbooks/environment.md',
  };
}

if (import.meta.main) {
  const expected = readFileSync(
    new URL('../.bun-version', import.meta.url),
    'utf8',
  ).trim();
  let failed = false;
  const versionOk = versionMatches(Bun.version, expected);
  console.log(
    `[doctor] Bun: ${Bun.version}; esperado: ${expected} — ${versionOk ? 'OK' : 'INCOMPATÍVEL'}`,
  );
  if (!versionOk) failed = true;

  for (const [label, command] of [
    ['Git', ['git', '--version']],
    ['Docker CLI', ['docker', '--version']],
    ['Docker daemon', ['docker', 'info', '--format', '{{.ServerVersion}}']],
    ['Docker Compose', ['docker', 'compose', 'version']],
    ['Docker Buildx', ['docker', 'buildx', 'version']],
  ] as const) {
    const { ok, detail } = diagnoseCommand(command);
    failed ||= !ok;
    console.log(`[doctor] ${label}: ${detail}`);
  }
  console.log(
    '[doctor] Diagnóstico somente; nenhuma instalação foi realizada. Docker é necessário nas etapas de integração do backend.',
  );
  process.exitCode = failed ? 1 : 0;
}
