import { describe, expect, it } from 'vitest';
import { fillBirthday } from '../src/modules/community/birthdays/celebrate.js';
import {
  daysUntil,
  isBirthdayToday,
  isValidBirthday,
  isValidTimeZone,
  localTime,
  observedDay,
  possibleBirthdays,
} from '../src/modules/community/birthdays/dates.js';

describe('localTime', () => {
  const now = new Date('2026-03-10T23:30:00Z');

  it('reads the date in the given timezone', () => {
    expect(localTime(now, 'UTC')).toEqual({ year: 2026, month: 3, day: 10, minutes: 23 * 60 + 30 });
    expect(localTime(now, 'Asia/Tokyo')).toMatchObject({ month: 3, day: 11, minutes: 8 * 60 + 30 });
    expect(localTime(new Date('2026-01-01T03:00:00Z'), 'America/New_York')).toMatchObject({ year: 2025, month: 12, day: 31 });
  });

  it('reports midnight as 0 minutes', () => {
    expect(localTime(new Date('2026-03-10T00:00:00Z'), 'UTC').minutes).toBe(0);
  });
});

describe('February 29', () => {
  it('is a valid birthday', () => {
    expect(isValidBirthday(2, 29)).toBe(true);
    expect(isValidBirthday(2, 30)).toBe(false);
    expect(isValidBirthday(4, 31)).toBe(false);
    expect(isValidBirthday(13, 1)).toBe(false);
  });

  it('is celebrated on February 28 outside leap years', () => {
    expect(observedDay(2, 29, 2027)).toEqual({ month: 2, day: 28 });
    expect(observedDay(2, 29, 2028)).toEqual({ month: 2, day: 29 });
    expect(observedDay(2, 29, 2100)).toEqual({ month: 2, day: 28 });
    expect(isBirthdayToday(2, 29, { year: 2027, month: 2, day: 28 })).toBe(true);
    expect(isBirthdayToday(2, 29, { year: 2028, month: 2, day: 28 })).toBe(false);
  });

  it('is found by the scheduler on February 28 of a common year', () => {
    expect(possibleBirthdays(new Date('2027-02-28T12:00:00Z'))).toContainEqual({ month: 2, day: 29 });
    expect(possibleBirthdays(new Date('2028-02-28T12:00:00Z'))).toContainEqual({ month: 2, day: 29 });
  });
});

describe('possibleBirthdays', () => {
  it('covers yesterday, today and tomorrow in UTC', () => {
    expect(possibleBirthdays(new Date('2026-01-01T05:00:00Z'))).toEqual([
      { month: 12, day: 31 },
      { month: 1, day: 1 },
      { month: 1, day: 2 },
    ]);
  });
});

describe('daysUntil', () => {
  const today = { year: 2026, month: 12, day: 30 };

  it('counts across the new year', () => {
    expect(daysUntil(12, 30, today)).toBe(0);
    expect(daysUntil(12, 31, today)).toBe(1);
    expect(daysUntil(1, 2, today)).toBe(3);
    expect(daysUntil(12, 29, today)).toBe(364);
  });

  it('uses February 28 for leap-day birthdays in common years', () => {
    expect(daysUntil(2, 29, { year: 2027, month: 2, day: 27 })).toBe(1);
    expect(daysUntil(2, 29, { year: 2028, month: 2, day: 27 })).toBe(2);
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects junk', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('fillBirthday', () => {
  it('fills placeholders and drops an unknown age', () => {
    const vars = { user: '<@1>', username: 'Sam', server: 'Lounge', age: 30 };
    expect(fillBirthday('{user} turns {age} in {server}', vars)).toBe('<@1> turns 30 in Lounge');
    expect(fillBirthday('{username} is {age}', { ...vars, age: null })).toBe('Sam is ');
  });
});
