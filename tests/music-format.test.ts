import { describe, expect, it } from 'vitest';
import { canControl, cleanTitle, formatTime, parseTimestamp, progressBar } from '../src/modules/music/format.js';

describe('formatTime', () => {
  it('formats minutes and hours', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(75_000)).toBe('1:15');
    expect(formatTime(3_725_000)).toBe('1:02:05');
    expect(formatTime(-5)).toBe('0:00');
  });
});

describe('parseTimestamp', () => {
  it.each([
    ['90', 90_000],
    ['1:30', 90_000],
    ['1:02:05', 3_725_000],
    ['1m30s', 90_000],
    ['2h', 7_200_000],
    ['45s', 45_000],
  ])('%s', (input, ms) => {
    expect(parseTimestamp(input)).toBe(ms);
  });

  it.each(['', 'abc', '1:75', '1:2:3:4', 'm'])('rejects %j', (input) => {
    expect(parseTimestamp(input)).toBeNull();
  });
});

describe('progressBar', () => {
  it('places the marker by progress', () => {
    expect(progressBar(0, 100, 5)).toBe('●────');
    expect(progressBar(50, 100, 5)).toBe('━━●──');
    expect(progressBar(100, 100, 5)).toBe('━━━━●');
    expect(progressBar(10, 0, 5)).toBe('─────');
  });
});

describe('cleanTitle', () => {
  it('escapes markdown and shortens long titles', () => {
    expect(cleanTitle('**Song** [click](http://x)')).toBe('\\*\\*Song\\*\\* \\[click\\]\\(http://x\\)');
    expect(cleanTitle('a'.repeat(100), 10)).toBe('aaaaaaa...');
  });
});

describe('canControl', () => {
  const base = { isStaff: false, isDj: false, djRolesSet: true, isRequester: false, listeners: 3 };

  it('lets everyone control when no DJ roles are set', () => {
    expect(canControl({ ...base, djRolesSet: false })).toBe(true);
  });

  it('limits control to DJs, staff, the requester or a lone listener', () => {
    expect(canControl(base)).toBe(false);
    expect(canControl({ ...base, isDj: true })).toBe(true);
    expect(canControl({ ...base, isStaff: true })).toBe(true);
    expect(canControl({ ...base, isRequester: true })).toBe(true);
    expect(canControl({ ...base, listeners: 1 })).toBe(true);
  });
});
