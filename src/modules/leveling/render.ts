import { AttachmentBuilder, type Guild, type User } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { renderRankCard } from './card.js';
import { progressFor } from './curve.js';
import { fetchImage } from '../../core/images.js';
import { BackgroundModel, ProfileModel, type ProfileDoc } from './models.js';
import { levelingSettings } from './settings.js';
import { curveOf, rankOf } from './xp.js';

const AVATAR_MAX_BYTES = 4 * 1024 * 1024;

export async function backgroundFor(guildId: string, userId: string, allowCustom: boolean): Promise<Buffer | null> {
  const ids = allowCustom ? [userId, ''] : [''];
  // Hydrated documents give a real Buffer; lean ones return BSON Binary, which is easy to misread.
  const docs = await BackgroundModel.find({ guildId, userId: { $in: ids } });
  const pick = docs.find((d) => d.userId === userId) ?? docs.find((d) => d.userId === '');
  return pick ? Buffer.from(pick.data) : null;
}

/**
 * Renders a member's rank card. Without a guild (a user-installed /rank in DMs or a server the
 * bot isn't in) it shows their XP summed over every server instead.
 */
export async function rankCard(bot: Bot, user: User, guild: Guild | null, locale: string): Promise<{ file: AttachmentBuilder; global: boolean }> {
  const t = (key: string) => bot.i18n.t(locale, key);
  const curve = curveOf(bot);
  const avatar = await fetchImage(user.displayAvatarURL({ extension: 'png', size: 256 }), AVATAR_MAX_BYTES);
  const labels = { rank: t('leveling.card.rank'), level: t('leveling.card.level'), xp: t('leveling.card.xp') };

  let xp: number;
  let rank: number | null = null;
  let background: Buffer | null = null;
  let preset = 'midnight';
  let accent = bot.config.bot.color;
  let displayName = user.displayName;

  if (guild) {
    const [profile, core, settings, member] = await Promise.all([
      ProfileModel.findOne({ guildId: guild.id, userId: user.id }).lean<ProfileDoc>(),
      bot.settings.get(guild.id),
      bot.settings.module(guild.id, levelingSettings),
      guild.members.fetch(user.id).catch(() => null),
    ]);
    xp = profile?.xp ?? 0;
    rank = profile ? await rankOf(guild, xp) : null;
    background = await backgroundFor(guild.id, user.id, settings.customCards);
    preset = (settings.customCards ? profile?.card.preset : null) ?? settings.background;
    accent = (settings.customCards ? profile?.card.color : null) ?? core.color ?? accent;
    displayName = member?.displayName ?? displayName;
  } else {
    const [total] = await ProfileModel.aggregate<{ xp: number }>([{ $match: { userId: user.id } }, { $group: { _id: null, xp: { $sum: '$xp' } } }]);
    xp = total?.xp ?? 0;
  }

  const progress = progressFor(xp, curve);
  const png = await renderRankCard({
    displayName,
    username: user.username,
    avatar,
    background,
    preset,
    accent,
    rank,
    level: progress.level,
    current: progress.current,
    needed: progress.needed,
    labels,
  });
  return { file: new AttachmentBuilder(png, { name: 'rank.png' }), global: !guild };
}
