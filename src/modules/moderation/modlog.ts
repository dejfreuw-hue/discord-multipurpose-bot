import { PermissionFlagsBits, type Guild, type Message } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import type { Panel } from '../../core/ui/panel.js';
import { moderationSettings } from './settings.js';

/**
 * Posts to the guild's mod log channel. Returns null when no channel is set or the bot can't
 * post there; a broken log channel must never stop the moderation action itself.
 */
export async function postModLog(bot: Bot, guild: Guild, panel: Panel): Promise<Message | null> {
  const { logChannelId } = await bot.settings.module(guild.id, moderationSettings);
  if (!logChannelId) return null;

  const channel = guild.channels.cache.get(logChannelId);
  const me = guild.members.me;
  if (!channel?.isSendable() || !me) return null;
  const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
  if (!channel.permissionsFor(me)?.has(needed)) {
    bot.logger.debug({ guild: guild.id, channel: channel.id }, 'cannot post to mod log');
    return null;
  }

  try {
    return await channel.send(panel.render());
  } catch (err) {
    bot.logger.warn({ err, guild: guild.id }, 'mod log post failed');
    return null;
  }
}
