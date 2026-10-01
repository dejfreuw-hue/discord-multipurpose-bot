/** 75000 -> "1:15", 3725000 -> "1:02:05". */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Reads a seek target: "1:30", "1:02:05", "90" (seconds) or "1m30s". Returns milliseconds or
 * null when it isn't a time.
 */
export function parseTimestamp(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  if (/^\d+(:\d{1,2}){1,2}$/.test(text)) {
    const parts = text.split(':').map(Number);
    if (parts.slice(1).some((p) => p >= 60)) return null;
    return parts.reduce((acc, p) => acc * 60 + p, 0) * 1000;
  }
  const match = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/.exec(text);
  if (match && (match[1] || match[2] || match[3])) {
    return ((Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60 + Number(match[3] ?? 0)) * 1000;
  }
  return null;
}

/** A text progress bar like "━━━━●──────────". */
export function progressBar(position: number, duration: number, width = 16): string {
  if (!Number.isFinite(duration) || duration <= 0) return '─'.repeat(width);
  const filled = Math.min(width - 1, Math.max(0, Math.round((position / duration) * (width - 1))));
  return `${'━'.repeat(filled)}●${'─'.repeat(width - 1 - filled)}`;
}

/** Strips markdown so a track title can't break formatting or fake links. */
export function cleanTitle(text: string, max = 80): string {
  const cleaned = text.replace(/([*_`~|\\[\]()>#])/g, '\\$1').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
}

export interface ControlCheck {
  isStaff: boolean;
  isDj: boolean;
  /** Whether the server has any DJ roles configured. */
  djRolesSet: boolean;
  /** Whether the member requested the track being acted on. */
  isRequester: boolean;
  /** Humans in the bot's voice channel, including the member. */
  listeners: number;
}

/**
 * Who may control playback. Without DJ roles everyone in the channel can. With DJ roles: DJs and
 * staff always, the requester for their own track, and anyone who is alone with the bot.
 */
export function canControl(check: ControlCheck): boolean {
  if (!check.djRolesSet || check.isStaff || check.isDj) return true;
  return check.isRequester || check.listeners <= 1;
}
