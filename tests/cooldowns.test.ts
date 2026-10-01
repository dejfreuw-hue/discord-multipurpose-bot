import { afterEach, describe, expect, it } from 'vitest';
import { Cooldowns } from '../src/core/cooldowns.js';

describe('Cooldowns', () => {
  let now = 0;
  const cooldowns = new Cooldowns(() => now);
  afterEach(() => cooldowns.dispose());

  it('tracks remaining time and expires', () => {
    cooldowns.start('ping:1', 3);
    expect(cooldowns.remaining('ping:1')).toBe(3000);
    now += 2500;
    expect(cooldowns.remaining('ping:1')).toBe(500);
    now += 600;
    expect(cooldowns.remaining('ping:1')).toBe(0);
  });

  it('ignores zero-second cooldowns and sweeps expired entries', () => {
    cooldowns.start('a', 0);
    expect(cooldowns.remaining('a')).toBe(0);
    cooldowns.start('b', 1);
    now += 2000;
    cooldowns.sweep();
    expect(cooldowns.size).toBe(0);
  });
});
