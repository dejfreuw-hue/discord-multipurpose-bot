import type { Message } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import type { Violation } from './enforce.js';
import { capsPercent, countMentions, findBadWord, findBlockedLink, findInviteCodes } from './filters.js';
import type { AutomodSettings } from './settings.js';
import { SpamTracker } from './spam.js';

export const spamTracker = new SpamTracker();

const INVITE_CACHE_MS = 10 * 60 * 1000;
const inviteGuilds = new Map<string, { guildId: string | null; at: number }>();

async function inviteGuild(bot: Bot, code: string): Promise<string | null> {
  const cached = inviteGuilds.get(code);
  if (cached && Date.now() - cached.at < INVITE_CACHE_MS) return cached.guildId;
  const guildId = await bot.client
    .fetchInvite(code)
    .then((invite) => invite.guild?.id ?? null)
    .catch(() => null);
  if (inviteGuilds.size > 1000) inviteGuilds.clear();
  inviteGuilds.set(code, { guildId, at: Date.now() });
  return guildId;
}

/**
 * Runs the enabled filters on a message, cheapest and most severe first, and returns the first
 * violation. Spam is only counted for new messages, not edits.
 */
export async function checkMessage(
  bot: Bot,
  message: Message<true>,
  settings: AutomodSettings,
  isEdit: boolean,
): Promise<Violation | null> {
  const { filters } = settings;
  const content = message.content;

  if (filters.mentions.enabled) {
    const count = countMentions(content);
    if (count >= filters.mentions.limit) return { filter: 'mentions', detail: String(count) };
  }

  if (filters.invites.enabled) {
    for (const code of findInviteCodes(content)) {
      if (filters.invites.allowOwnServer && (await inviteGuild(bot, code)) === message.guildId) continue;
      return { filter: 'invites', detail: `discord.gg/${code}` };
    }
  }

  if (filters.links.enabled) {
    const host = findBlockedLink(content, filters.links.allowedDomains);
    if (host) return { filter: 'links', detail: host };
  }

  if (filters.badWords.enabled) {
    const word = findBadWord(content, filters.badWords.words);
    if (word) return { filter: 'badWords', detail: `||${word}||` };
  }

  if (filters.caps.enabled) {
    const percent = capsPercent(content, filters.caps.minLength);
    if (percent !== null && percent >= filters.caps.percent) return { filter: 'caps', detail: `${percent}%` };
  }

  if (filters.spam.enabled && !isEdit) {
    const hit = spamTracker.record(`${message.guildId}:${message.author.id}`, message, filters.spam);
    if (hit) return { filter: 'spam', detail: hit.kind, related: hit.messages };
  }

  return null;
}
