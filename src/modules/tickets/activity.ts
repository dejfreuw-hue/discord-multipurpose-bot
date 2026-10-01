import type { Bot } from '../../core/bot.js';
import { TicketModel } from './models.js';

const WRITE_EVERY_MS = 60_000;

/**
 * Open ticket and modmail channels, kept in memory so every message in the server doesn't
 * need a database lookup to find out whether it belongs to a ticket.
 */
const openChannels = new Map<string, { kind: 'ticket' | 'modmail'; lastWrite: number }>();

export function trackChannel(channelId: string, kind: 'ticket' | 'modmail'): void {
  openChannels.set(channelId, { kind, lastWrite: Date.now() });
}

export function untrackChannel(channelId: string): void {
  openChannels.delete(channelId);
}

export function trackedKind(channelId: string): 'ticket' | 'modmail' | undefined {
  return openChannels.get(channelId)?.kind;
}

export async function loadOpenChannels(): Promise<number> {
  const open = await TicketModel.find({ status: 'open' }, { channelId: 1, kind: 1 }).lean();
  for (const t of open) trackChannel(t.channelId, t.kind);
  return open.length;
}

/** Records activity in a ticket channel, writing to the database at most once a minute per ticket. */
export async function touch(bot: Bot, channelId: string): Promise<void> {
  const entry = openChannels.get(channelId);
  if (!entry || Date.now() - entry.lastWrite < WRITE_EVERY_MS) return;
  entry.lastWrite = Date.now();
  await TicketModel.updateOne({ channelId, status: 'open' }, { lastActivityAt: new Date(), reminderSentAt: null }).catch((err) =>
    bot.logger.warn({ err }, 'ticket activity update failed'),
  );
}
