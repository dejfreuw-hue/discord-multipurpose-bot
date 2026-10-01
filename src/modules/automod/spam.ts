import { createHash } from 'node:crypto';

interface Entry {
  at: number;
  messageId: string;
  channelId: string;
  hash: string;
}

export interface SpamLimits {
  messages: number;
  seconds: number;
  duplicates: number;
}

export interface SpamHit {
  kind: 'burst' | 'duplicates';
  /** Recent messages that are part of the spam, so they can be cleaned up together. */
  messages: { messageId: string; channelId: string }[];
}

/**
 * Remembers each member's recent messages to catch bursts (too many messages too fast) and
 * repeated identical messages. Memory only: spam is about seconds, not something to persist.
 */
export class SpamTracker {
  private readonly recent = new Map<string, Entry[]>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly now: () => number = Date.now,
    /** Duplicates are tracked over a longer window than bursts. */
    private readonly duplicateWindowMs = 60_000,
  ) {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }

  record(key: string, message: { id: string; channelId: string; content: string }, limits: SpamLimits): SpamHit | null {
    const now = this.now();
    const hash = createHash('sha1').update(message.content.trim().toLowerCase()).digest('base64');
    const keepFor = Math.max(this.duplicateWindowMs, limits.seconds * 1000);
    const entries = (this.recent.get(key) ?? []).filter((e) => now - e.at < keepFor);
    entries.push({ at: now, messageId: message.id, channelId: message.channelId, hash });
    this.recent.set(key, entries);

    const burst = entries.filter((e) => now - e.at < limits.seconds * 1000);
    if (burst.length >= limits.messages) return this.hit(key, 'burst', burst);

    // Empty content (attachments only) all hashes the same, so it never counts as a duplicate.
    if (message.content.trim()) {
      const same = entries.filter((e) => e.hash === hash);
      if (same.length >= limits.duplicates) return this.hit(key, 'duplicates', same);
    }
    return null;
  }

  forget(key: string): void {
    this.recent.delete(key);
  }

  sweep(): void {
    const now = this.now();
    for (const [key, entries] of this.recent) {
      if (entries.every((e) => now - e.at >= this.duplicateWindowMs)) this.recent.delete(key);
    }
  }

  dispose(): void {
    clearInterval(this.sweeper);
  }

  private hit(key: string, kind: SpamHit['kind'], entries: Entry[]): SpamHit {
    // Start over so the same burst doesn't trigger again on every following message.
    this.recent.delete(key);
    return { kind, messages: entries.map((e) => ({ messageId: e.messageId, channelId: e.channelId })) };
  }
}
