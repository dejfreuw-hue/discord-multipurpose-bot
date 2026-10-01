/** In-memory cooldown tracker. Entries are swept periodically so long-running bots don't grow forever. */
export class Cooldowns {
  private readonly expiries = new Map<string, number>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly now: () => number = Date.now,
    sweepEveryMs = 60_000,
  ) {
    this.sweeper = setInterval(() => this.sweep(), sweepEveryMs);
    this.sweeper.unref();
  }

  /** Milliseconds left on `key`, or 0 when it is free to use. */
  remaining(key: string): number {
    const expiry = this.expiries.get(key);
    if (expiry === undefined) return 0;
    return Math.max(0, expiry - this.now());
  }

  start(key: string, seconds: number): void {
    if (seconds <= 0) return;
    this.expiries.set(key, this.now() + seconds * 1000);
  }

  clear(key: string): void {
    this.expiries.delete(key);
  }

  sweep(): void {
    const now = this.now();
    for (const [key, expiry] of this.expiries) if (expiry <= now) this.expiries.delete(key);
  }

  get size(): number {
    return this.expiries.size;
  }

  dispose(): void {
    clearInterval(this.sweeper);
  }
}
