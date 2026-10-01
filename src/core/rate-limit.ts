/** Sliding-window limiter: at most `limit` hits per key within `windowMs`. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit and returns true, or returns false without recording when the key is over its limit. */
  take(key: string, limit: number): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [key, times] of this.hits) if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
  }
}
