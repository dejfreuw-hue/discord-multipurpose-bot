import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration } from '../src/core/duration.js';

describe('parseDuration', () => {
  it.each([
    ['10s', 10_000],
    ['10m', 600_000],
    ['1h30m', 5_400_000],
    ['1h 30m', 5_400_000],
    ['2 days', 172_800_000],
    ['1w, 2d', 777_600_000],
    ['1.5h', 5_400_000],
    ['15', 900_000],
    ['  3H ', 10_800_000],
  ])('%s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', 'soon', '10x', '1h banana', 'h', '0m', '-5m'])('rejects %j', (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('renders compact units', () => {
    expect(formatDuration(90_061_000)).toBe('1d 1h 1m 1s');
    expect(formatDuration(1_209_600_000)).toBe('2w');
    expect(formatDuration(500)).toBe('0s');
  });

  it('round-trips with parseDuration', () => {
    for (const ms of [60_000, 5_400_000, 777_600_000]) expect(parseDuration(formatDuration(ms))).toBe(ms);
  });
});
