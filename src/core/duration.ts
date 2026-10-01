const UNITS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
};

/**
 * Parses durations people type in Discord: "10m", "1h30m", "2 days", "1w 2d".
 * Returns milliseconds, or null when the text isn't a duration. A bare number counts as minutes.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text) * 60_000;

  const pattern = /(\d+(?:\.\d+)?)\s*([a-z]+)\s*,?\s*/gy;
  let total = 0;
  let consumed = 0;
  for (const match of text.matchAll(pattern)) {
    const unit = UNITS[match[2]!];
    if (unit === undefined) return null;
    total += Number(match[1]) * unit;
    consumed += match[0].length;
  }
  if (consumed !== text.length || total <= 0) return null;
  return Math.round(total);
}

/** Compact, language-neutral rendering: 90061000 -> "1d 1h 1m 1s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return '0s';
  const parts: string[] = [];
  let rest = Math.floor(ms / 1000);
  for (const [label, size] of [
    ['w', 604_800],
    ['d', 86_400],
    ['h', 3_600],
    ['m', 60],
    ['s', 1],
  ] as const) {
    const amount = Math.floor(rest / size);
    if (amount > 0) parts.push(`${amount}${label}`);
    rest -= amount * size;
  }
  return parts.join(' ');
}
