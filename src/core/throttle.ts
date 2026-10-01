/**
 * Runs a task per key at most once every `intervalMs`, for things like refreshing a message after
 * every button click. Calls in between are merged into one trailing run, so the last change is
 * never lost, and runs for the same key never overlap.
 */
export function throttler(intervalMs: number) {
  const lastRun = new Map<string, number>();
  const scheduled = new Set<string>();
  const running = new Set<string>();
  // Newest task requested while one was running for that key.
  const pending = new Map<string, () => Promise<unknown>>();

  const schedule = (key: string, task: () => Promise<unknown>) => {
    scheduled.add(key);
    const wait = Math.max(0, (lastRun.get(key) ?? 0) + intervalMs - Date.now());
    setTimeout(() => void execute(key, task), wait).unref();
  };

  const execute = async (key: string, task: () => Promise<unknown>) => {
    scheduled.delete(key);
    running.add(key);
    lastRun.set(key, Date.now());
    await task().catch(() => undefined);
    running.delete(key);
    const next = pending.get(key);
    if (next) {
      pending.delete(key);
      schedule(key, next);
    }
    if (lastRun.size > 5000) for (const [k, t] of lastRun) if (Date.now() - t > intervalMs) lastRun.delete(k);
  };

  return (key: string, task: () => Promise<unknown>): void => {
    if (running.has(key)) {
      pending.set(key, task);
      return;
    }
    if (!scheduled.has(key)) schedule(key, task);
  };
}
