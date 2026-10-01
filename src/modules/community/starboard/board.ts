import { ButtonBuilder, ButtonStyle, type Guild, type GuildTextBasedChannel, type Message } from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import { emojiKey, reactionKey } from '../../../core/emoji.js';
import { throttler } from '../../../core/throttle.js';
import { StarEntryModel, type StarEntryDoc } from './model.js';
import { starboardSettings } from './settings.js';

const STAR_COLOR = 0xf5c518;
const sync = throttler(2500);

/** Stars on a message, leaving out the author's own unless self-starring is on. */
export async function countStars(message: Pick<Message, 'reactions' | 'author'>, emoji: string, selfStar: boolean): Promise<number> {
  const key = emojiKey(emoji);
  const reaction = message.reactions.cache.find((r) => reactionKey(r.emoji) === key);
  if (!reaction) return 0;
  if (selfStar) return reaction.count;
  // Checking who reacted costs a request; past 100 stars one self-star doesn't matter.
  if (reaction.count > 100) return reaction.count;
  const users = await reaction.users.fetch().catch(() => null);
  return users?.has(message.author.id) ? reaction.count - 1 : reaction.count;
}

function firstImage(message: Message<true>): string | null {
  const attachment = message.attachments.find((a) => a.contentType?.startsWith('image/'));
  return attachment?.url ?? message.embeds.find((e) => e.image)?.image?.url ?? message.embeds.find((e) => e.thumbnail)?.thumbnail?.url ?? null;
}

async function render(bot: Bot, message: Message<true>, count: number, emoji: string) {
  const t = bot.i18n.t.bind(bot.i18n, bot.guildLocale(await bot.settings.get(message.guildId)));
  const text = message.content || message.embeds[0]?.description || null;
  return bot
    .panel(STAR_COLOR)
    .thumbnail(message.author.displayAvatarURL({ size: 128 }))
    .text(`**${message.member?.displayName ?? message.author.username}** ${t('starboard.post.in', { channel: message.channel.toString() })}`, text)
    .image(firstImage(message))
    .footer(`${emoji} ${count}`)
    .row(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(message.url).setLabel(t('starboard.post.jump')))
    .render();
}

async function removePost(guild: Guild, entry: StarEntryDoc, starboardId: string | null): Promise<void> {
  await StarEntryModel.deleteOne({ guildId: entry.guildId, messageId: entry.messageId });
  const board = starboardId ? guild.channels.cache.get(starboardId) : null;
  if (board?.isTextBased()) await board.messages.delete(entry.starboardMessageId).catch(() => undefined);
}

async function syncNow(bot: Bot, guild: Guild, channelId: string, messageId: string): Promise<void> {
  const settings = await bot.settings.module(guild.id, starboardSettings);
  const board = settings.channelId ? guild.channels.cache.get(settings.channelId) : null;
  if (!board?.isSendable() || !board.isTextBased()) return;
  const entry = await StarEntryModel.findOne({ guildId: guild.id, messageId }).lean<StarEntryDoc>();

  const source = guild.channels.cache.get(channelId);
  const message = source?.isTextBased() ? await source.messages.fetch({ message: messageId, force: true }).catch(() => null) : null;
  if (!message) {
    if (entry) await removePost(guild, entry, board.id);
    return;
  }

  const count = await countStars(message, settings.emoji, settings.selfStar);
  if (count < settings.threshold) {
    if (entry) await removePost(guild, entry, board.id);
    return;
  }

  const payload = { ...(await render(bot, message, count, settings.emoji)), allowedMentions: { parse: [] } };
  if (entry) {
    const edited = await board.messages.edit(entry.starboardMessageId, payload).catch(() => null);
    if (edited) {
      await StarEntryModel.updateOne({ guildId: guild.id, messageId }, { count });
      return;
    }
    // The board post was deleted by hand; post it again below.
  }
  const posted = await board.send(payload);
  await StarEntryModel.updateOne(
    { guildId: guild.id, messageId },
    { channelId, starboardMessageId: posted.id, count },
    { upsert: true },
  );
}

/**
 * Brings the board post for a message in line with its current star count. Calls are throttled
 * and serialized per message, so a burst of reactions can't post it twice.
 */
export function syncStarboard(bot: Bot, guild: Guild, channelId: string, messageId: string): void {
  sync(`${guild.id}:${messageId}`, () => syncNow(bot, guild, channelId, messageId));
}

/** Whether reactions in this channel can put messages on the board. */
export async function watchesChannel(bot: Bot, channel: GuildTextBasedChannel): Promise<boolean> {
  const { guild } = channel;
  if (!bot.isEnabled('starboard', await bot.settings.get(guild.id))) return false;
  const settings = await bot.settings.module(guild.id, starboardSettings);
  const ids = [channel.id, channel.isThread() ? channel.parentId : null];
  if (!settings.channelId || ids.some((id) => id && (id === settings.channelId || settings.ignoredChannelIds.includes(id)))) return false;
  // Never copy NSFW content into a channel that isn't marked NSFW.
  const board = guild.channels.cache.get(settings.channelId);
  return !isNsfw(channel) || Boolean(board?.isTextBased() && isNsfw(board));
}

function isNsfw(channel: GuildTextBasedChannel): boolean {
  if (channel.isThread()) return Boolean(channel.parent?.nsfw);
  return 'nsfw' in channel && channel.nsfw;
}
