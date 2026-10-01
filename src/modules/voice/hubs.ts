import { ChannelType, PermissionFlagsBits, type Guild } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { UserError } from '../../core/errors.js';
import { hubSchema, voiceSettings, type Hub } from './settings.js';

export const MAX_HUBS = 10;

export async function addHub(bot: Bot, guild: Guild, hub: Partial<Hub> & { channelId: string }): Promise<void> {
  const settings = await bot.settings.module(guild.id, voiceSettings);
  const others = settings.hubs.filter((h) => h.channelId !== hub.channelId);
  if (others.length >= MAX_HUBS) throw new UserError('ai.errors.listFull', { max: MAX_HUBS });
  const full = hubSchema.parse(hub);
  await bot.settings.updateModule(guild.id, voiceSettings, { hubs: [...others, full] });
}

/** One click setup: a "Voice Channels" category with a "Join to Create" channel in it. */
export async function createHub(bot: Bot, guild: Guild, labels: { category: string; hub: string }): Promise<string> {
  const me = guild.members.me;
  if (!me?.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers])) {
    throw new UserError('errors.botPermissions', { permissions: 'Manage Channels, Move Members' });
  }
  const category = await guild.channels.create({ name: labels.category, type: ChannelType.GuildCategory, reason: 'join-to-create setup' });
  const channel = await guild.channels.create({ name: labels.hub, type: ChannelType.GuildVoice, parent: category.id, reason: 'join-to-create setup' });
  await addHub(bot, guild, { channelId: channel.id, categoryId: category.id });
  return channel.id;
}
