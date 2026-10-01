export interface LocalTime {
  year: number;
  month: number;
  day: number;
  /** Minutes since local midnight. */
  minutes: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date and time of day at `now` in a timezone. */
export function localTime(now: Date, timeZone: string): LocalTime {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Whether month/day exists in at least some years (so Feb 29 is valid). */
export function isValidBirthday(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1]!;
}

/** The day a birthday falls on in a given year. Feb 29 birthdays are celebrated on Feb 28 otherwise. */
export function observedDay(month: number, day: number, year: number): { month: number; day: number } {
  return month === 2 && day === 29 && !isLeapYear(year) ? { month: 2, day: 28 } : { month, day };
}

export function isBirthdayToday(month: number, day: number, today: Pick<LocalTime, 'year' | 'month' | 'day'>): boolean {
  const observed = observedDay(month, day, today.year);
  return observed.month === today.month && observed.day === today.day;
}

/** Whole days until the next birthday; 0 means today. */
export function daysUntil(month: number, day: number, today: Pick<LocalTime, 'year' | 'month' | 'day'>): number {
  const start = Date.UTC(today.year, today.month - 1, today.day);
  for (const year of [today.year, today.year + 1]) {
    const observed = observedDay(month, day, year);
    const date = Date.UTC(year, observed.month - 1, observed.day);
    if (date >= start) return Math.round((date - start) / 86_400_000);
  }
  return 366;
}

/**
 * Month/day pairs that could be someone's birthday right now somewhere on Earth. Local dates
 * are at most a day off from UTC, so the scheduler only has to look at these.
 */
export function possibleBirthdays(now: Date): { month: number; day: number }[] {
  const result: { month: number; day: number }[] = [];
  for (const offset of [-1, 0, 1]) {
    const date = new Date(now.getTime() + offset * 86_400_000);
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    result.push({ month, day });
    if (month === 2 && day === 28 && !isLeapYear(date.getUTCFullYear())) result.push({ month: 2, day: 29 });
  }
  return result;
}
