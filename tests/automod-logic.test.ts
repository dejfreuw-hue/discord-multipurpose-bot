import { afterEach, describe, expect, it } from 'vitest';
import { stepFor } from '../src/modules/automod/escalation.js';
import type { LadderStep } from '../src/modules/automod/settings.js';
import { SpamTracker } from '../src/modules/automod/spam.js';

describe('SpamTracker', () => {
  let now = 0;
  const tracker = new SpamTracker(() => now);
  const limits = { messages: 4, seconds: 5, duplicates: 3 };
  let id = 0;
  const send = (content: string, key = 'g:u') => tracker.record(key, { id: String(++id), channelId: 'c', content }, limits);
  afterEach(() => {
    tracker.forget('g:u');
    tracker.forget('g:other');
  });

  it('flags a burst of messages inside the window', () => {
    expect(send('a')).toBeNull();
    expect(send('b')).toBeNull();
    expect(send('c')).toBeNull();
    const hit = send('d');
    expect(hit?.kind).toBe('burst');
    expect(hit?.messages).toHaveLength(4);
  });

  it('does not flag the same number of messages spread out', () => {
    for (const text of ['a', 'b', 'c', 'd', 'e']) {
      expect(send(text)).toBeNull();
      now += 2000;
    }
  });

  it('flags repeated identical messages over a longer window', () => {
    expect(send('buy now')).toBeNull();
    now += 10_000;
    expect(send('BUY NOW ')).toBeNull();
    now += 10_000;
    expect(send('buy now')?.kind).toBe('duplicates');
  });

  it('keeps members separate and resets after a hit', () => {
    send('a');
    send('b');
    send('c', 'g:other');
    expect(send('d')).toBeNull();
    expect(send('e')?.kind).toBe('burst');
    expect(send('f')).toBeNull();
  });
});

describe('stepFor', () => {
  const ladder: LadderStep[] = [
    { strikes: 3, action: 'timeout', duration: 600_000 },
    { strikes: 5, action: 'timeout', duration: 3_600_000 },
    { strikes: 8, action: 'kick', duration: null },
  ];

  it('returns nothing below the first step', () => {
    expect(stepFor(ladder, 0, 2)).toBeNull();
  });

  it('applies a step when it is crossed', () => {
    expect(stepFor(ladder, 2, 3)?.duration).toBe(600_000);
  });

  it('does not repeat a step that was already crossed', () => {
    expect(stepFor(ladder, 3, 4)).toBeNull();
  });

  it('picks the highest step when a big violation skips several', () => {
    expect(stepFor(ladder, 2, 9)?.action).toBe('kick');
  });

  it('works with an unsorted ladder', () => {
    expect(stepFor([...ladder].reverse(), 4, 6)?.duration).toBe(3_600_000);
  });
});
