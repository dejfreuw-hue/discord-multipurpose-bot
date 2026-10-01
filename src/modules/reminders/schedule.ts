/**
 * The next time a repeating reminder fires after `now`. Occurrences missed while the bot was
 * offline are skipped rather than delivered in a burst.
 */
export function nextOccurrence(dueAt: Date, repeatMs: number, now: Date): Date {
  const missed = Math.floor((now.getTime() - dueAt.getTime()) / repeatMs) + 1;
  return new Date(dueAt.getTime() + Math.max(1, missed) * repeatMs);
}

/** Whether a reminder is late enough that the message should say so. */
export function isLate(dueAt: Date, now: Date): boolean {
  return now.getTime() - dueAt.getTime() > 2 * 60_000;
}
