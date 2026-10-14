import { setTimeout as sleep } from 'node:timers/promises';
export async function runMessageWorker(
  work: () => Promise<boolean>,
  signal: AbortSignal,
  report: (event: Record<string, unknown>) => void,
  once = false,
): Promise<void> {
  while (!signal.aborted) {
    let didWork = false;
    try {
      didWork = await work();
    } catch (error) {
      if (signal.aborted) return;
      report({ level: 'error', event: 'message_worker_iteration_failed' });
      if (once) throw error;
    }
    if (once) return;
    if (!didWork) {
      try {
        await sleep(500, undefined, { signal });
      } catch (error) {
        if (!signal.aborted) throw error;
      }
    }
  }
}
