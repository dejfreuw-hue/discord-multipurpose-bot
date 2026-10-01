/** The number a counting message starts with, or null for chat. "12" and "12 we're close" both count. */
export function parseCount(content: string): number | null {
  const match = /^\s*(\d{1,15})(?=\s|$)/.exec(content);
  return match ? Number(match[1]) : null;
}

export type CountVerdict = 'ok' | 'wrongNumber' | 'twice';

export function judgeCount(
  state: { current: number; lastUserId: string | null },
  userId: string,
  value: number,
  allowTwice: boolean,
): CountVerdict {
  if (value !== state.current + 1) return 'wrongNumber';
  if (!allowTwice && state.lastUserId === userId) return 'twice';
  return 'ok';
}
