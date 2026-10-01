/*
 * Join-to-Create rules that don't need Discord: channel naming, rename limits and who may
 * manage a channel.
 */

const MAX_NAME = 100;

/** Fills a name template like "{user}'s channel" or "{game} | {user}". Falls back when empty. */
export function channelName(template: string, vars: { user: string; game?: string | null; count?: number }): string {
  const name = template
    .replace(/\{user\}/g, vars.user)
    .replace(/\{game\}/g, vars.game ?? vars.user)
    .replace(/\{count\}/g, String(vars.count ?? 1))
    .replace(/\s+/g, ' ')
    .trim();
  return (name || vars.user || 'Voice').slice(0, MAX_NAME);
}

/** Discord allows two renames per channel every ten minutes; anything more just queues for minutes. */
export const RENAME_LIMIT = 2;
export const RENAME_WINDOW_MS = 10 * 60 * 1000;

/** Milliseconds until another rename is allowed given the recent rename times, or 0 if now is fine. */
export function renameWait(recent: readonly number[], now: number): number {
  const inWindow = recent.filter((t) => now - t < RENAME_WINDOW_MS).sort((a, b) => a - b);
  if (inWindow.length < RENAME_LIMIT) return 0;
  return inWindow[inWindow.length - RENAME_LIMIT]! + RENAME_WINDOW_MS - now;
}

export interface ManageCheck {
  isOwner: boolean;
  /** Server staff or anyone with Manage Channels. */
  isStaff: boolean;
}

export function canManage(check: ManageCheck): boolean {
  return check.isOwner || check.isStaff;
}

/** A channel can be claimed by someone inside it once its owner has left. */
export function canClaim(ownerInChannel: boolean, claimerInChannel: boolean): boolean {
  return !ownerInChannel && claimerInChannel;
}
