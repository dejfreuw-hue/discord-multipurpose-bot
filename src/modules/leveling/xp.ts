import { PermissionFlagsBits, type Guild, type GuildMember, type GuildTextBasedChannel } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { progressFor, rewardRoles, type Curve } from './curve.js';
import { ProfileModel, type ProfileDoc } from './models.js';
import { levelingConfig, levelingSettings, type LevelingSettings } from './settings.js';

export function curveOf(bot: Bot): Curve {
  return bot.moduleConfig({ name: 'leveling', config: levelingConfig }).curve;
}

export function isIgnored(member: GuildMember, channelId: string | null, parentId: string | null, settings: LevelingSettings): boolean {
  if (settings.ignoredRoles.some((id) => member.roles.cache.has(id))) return true;
  return [channelId, parentId].some((id) => id !== null && settings.ignoredChannels.includes(id));
}

/** The member's best role multiplier, or 1. A 0 multiplier is a way to stop a role from earning XP. */
export function multiplierFor(member: GuildMember, settings: LevelingSettings): number {
  const matching = settings.multipliers.filter((m) => member.roles.cache.has(m.roleId)).map((m) => m.value);
  return matching.length > 0 ? Math.max(...matching) : 1;
}

/**
 * Adds XP and handles level-ups. The level is bumped with a conditional update, so two XP
 * grants racing each other can't announce the same level twice.
 */
export async function grantXp(
  bot: Bot,
  member: GuildMember,
  amount: number,
  kind: 'message' | 'voice',
  channel: GuildTextBasedChannel | null,
): Promise<void> {
  if (amount <= 0) return;
  const profile = await ProfileModel.findOneAndUpdate(
    { guildId: member.guild.id, userId: member.id },
    { $inc: { xp: amount, messages: kind === 'message' ? 1 : 0, voiceMinutes: kind === 'voice' ? 1 : 0 } },
    { upsert: true, returnDocument: 'after', lean: true },
  );
  if (!profile) return;
  const { level } = progressFor(profile.xp, curveOf(bot));
  if (level <= profile.level) return;

  const bumped = await ProfileModel.updateOne({ guildId: member.guild.id, userId: member.id, level: profile.level }, { level });
  if (bumped.modifiedCount === 0) return;
  const settings = await bot.settings.module(member.guild.id, levelingSettings);
  await syncRewards(bot, member, level, settings);
  await announce(bot, member, level, settings, channel);
}

/** Sets a member's XP outright (admin commands), fixing their level and roles without announcing. */
export async function setXp(bot: Bot, member: GuildMember, xp: number): Promise<ProfileDoc> {
  const value = Math.max(0, Math.round(xp));
  const { level } = progressFor(value, curveOf(bot));
  const profile = await ProfileModel.findOneAndUpdate(
    { guildId: member.guild.id, userId: member.id },
    { xp: value, level },
    { upsert: true, returnDocument: 'after', lean: true },
  );
  await syncRewards(bot, member, level, await bot.settings.module(member.guild.id, levelingSettings));
  return profile!;
}

/** Gives the reward roles a member's level earns and takes away the ones it no longer does. */
export async function syncRewards(bot: Bot, member: GuildMember, level: number, settings: LevelingSettings): Promise<void> {
  if (settings.rewards.length === 0) return;
  const me = member.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return;

  // Roles above the bot or managed by integrations can't be assigned; skip them quietly.
  const assignable = (id: string) => {
    const role = member.guild.roles.cache.get(id);
    return Boolean(role && !role.managed && me.roles.highest.comparePositionTo(role) > 0);
  };
  const wanted = new Set(rewardRoles(settings.rewards, level, settings.stackRewards));
  const add = [...wanted].filter((id) => assignable(id) && !member.roles.cache.has(id));
  const remove = settings.rewards
    .map((r) => r.roleId)
    .filter((id) => !wanted.has(id) && assignable(id) && member.roles.cache.has(id));

  try {
    if (add.length > 0) await member.roles.add(add, `level ${level} reward`);
    if (remove.length > 0) await member.roles.remove(remove, `level ${level} reward`);
  } catch (err) {
    bot.logger.warn({ err, guild: member.guild.id, user: member.id }, 'could not update level rewards');
  }
}

async function announce(
  bot: Bot,
  member: GuildMember,
  level: number,
  settings: LevelingSettings,
  channel: GuildTextBasedChannel | null,
): Promise<void> {
  const { mode, channelId, message } = settings.announce;
  if (mode === 'off') return;
  const core = await bot.settings.get(member.guild.id);
  const vars = { user: member.toString(), username: member.displayName, level };
  const text = message
    ? message.replace(/\{user\}/g, vars.user).replace(/\{username\}/g, vars.username).replace(/\{level\}/g, String(level))
    : bot.i18n.t(bot.guildLocale(core), 'leveling.levelUp', vars);
  const payload = { ...bot.panel(core.color ?? bot.config.bot.color).text(text).render(), allowedMentions: { users: [member.id] } };

  if (mode === 'dm') {
    await member.send(payload).catch(() => undefined);
    return;
  }
  const target = mode === 'fixed' && channelId ? member.guild.channels.cache.get(channelId) : channel;
  if (target?.isSendable()) await target.send(payload).catch((err) => bot.logger.debug({ err }, 'level-up announcement failed'));
}

export async function rankOf(guild: Guild, xp: number): Promise<number> {
  return (await ProfileModel.countDocuments({ guildId: guild.id, xp: { $gt: xp } })) + 1;
}
