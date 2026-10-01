import type { Guild, SendableChannels } from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import { throttler } from '../../../core/throttle.js';
import { StickyModel, type StickyDoc } from './model.js';

/** Channels with a sticky message, so ordinary messages skip the database entirely. */
export const stickyChannels = new Set<string>();

export async function loadStickyChannels(): Promise<void> {
  const docs = await StickyModel.find({}, { channelId: 1 }).lean<Pick<StickyDoc, 'channelId'>[]>();
  stickyChannels.clear();
  for (const doc of docs) stickyChannels.add(doc.channelId);
}

async function renderSticky(bot: Bot, guild: Guild, content: string) {
  const settings = await bot.settings.get(guild.id);
  const label = bot.i18n.t(bot.guildLocale(settings), 'sticky.label');
  return { ...bot.panel().text(content, `-# ${label}`).render(), allowedMentions: { parse: [] } };
}

/** Deletes the previous copy and posts the sticky message again at the bottom of the channel. */
async function repostSticky(bot: Bot, channel: SendableChannels & { guild: Guild }): Promise<void> {
  const sticky = await StickyModel.findOne({ channelId: channel.id }).lean<StickyDoc>();
  if (!sticky) {
    stickyChannels.delete(channel.id);
    return;
  }
  if (sticky.messageId && 'messages' in channel) await channel.messages.delete(sticky.messageId).catch(() => undefined);
  const sent = await channel.send(await renderSticky(bot, channel.guild, sticky.content));
  await StickyModel.updateOne({ channelId: channel.id }, { messageId: sent.id });
}

// Busy channels would otherwise get a delete and a send for every single message.
const throttled = throttler(8000);

export function scheduleRepost(bot: Bot, channel: SendableChannels & { guild: Guild }): void {
  throttled(channel.id, () => repostSticky(bot, channel));
}
