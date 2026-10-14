import { setTimeout as sleep } from 'node:timers/promises';

export async function runReferenceWorker(
  retry: () => Promise<unknown | undefined>,
  signal: AbortSignal,
  report: (event: Record<string, unknown>) => void,
  once = false,
): Promise<void> {
  while (!signal.aborted) {
    for (let count = 0; count < 100 && !signal.aborted; count++) {
      try {
        const result = await retry();
        if (!result) break;
        report({
          level: 'info',
          event: 'reference_attempt',
          ...(result as Record<string, unknown>),
        });
      } catch (error) {
        report({ level: 'error', event: 'reference_attempt_failed' });
        if (once) throw error;
        break;
      }
    }
    if (once) return;
    try {
      await sleep(500, undefined, { signal });
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }
}
