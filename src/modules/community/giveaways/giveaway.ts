import { ButtonBuilder, ButtonStyle, roleMention, time, TimestampStyles, userMention, type Guild, type GuildMember } from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import { UserError } from '../../../core/errors.js';
import { throttler } from '../../../core/throttle.js';
import { ProfileModel } from '../../leveling/models.js';
import { progressFor } from '../../leveling/curve.js';
import { curveOf } from '../../leveling/xp.js';
import { entriesFor, pickWinners } from './draw.js';
import { GiveawayModel, type GiveawayDoc } from './model.js';

const DAY = 86_400_000;
const refresh = throttler(10_000);

type T = (key: string, vars?: Record<string, string | number>) => string;

async function translator(bot: Bot, guildId: string): Promise<{ t: T; color: number }> {
  const core = await bot.settings.get(guildId);
  const locale = bot.guildLocale(core);
  return { t: (k, v) => bot.i18n.t(locale, k, v), color: core.color ?? bot.config.bot.color };
}

export async function renderGiveaway(bot: Bot, g: GiveawayDoc) {
  const { t, color } = await translator(bot, g.guildId);
  const r = g.requirements;
  const requirements = [
    r.roleId ? t('giveaways.req.role', { role: roleMention(r.roleId) }) : null,
    r.minAccountDays ? t('giveaways.req.account', { count: r.minAccountDays }) : null,
    r.minServerDays ? t('giveaways.req.server', { count: r.minServerDays }) : null,
    r.minLevel ? t('giveaways.req.level', { level: r.minLevel }) : null,
  ].filter(Boolean);
  const bonuses = [
    g.bonus.boosterEntries ? t('giveaways.bonus.booster', { count: g.bonus.boosterEntries }) : null,
    ...g.bonus.bonusRoles.map((b) => t('giveaways.bonus.role', { role: roleMention(b.roleId), count: b.entries })),
  ].filter(Boolean);

  const running = g.status === 'running';
  const panel = bot
    .panel(running ? color : 0x4f545c)
    .title(g.prize)
    .text(g.description)
    .fields([
      running
        ? { name: t('giveaways.panel.ends'), value: `${time(g.endsAt, TimestampStyles.RelativeTime)} (${time(g.endsAt, TimestampStyles.ShortDateTime)})`, inline: true }
        : { name: t('giveaways.panel.ended'), value: time(g.endsAt, TimestampStyles.ShortDateTime), inline: true },
      { name: t('giveaways.panel.host'), value: userMention(g.hostId), inline: true },
      { name: t('giveaways.panel.entries'), value: String(g.entrants.length), inline: true },
      ...(requirements.length ? [{ name: t('giveaways.panel.requirements'), value: requirements.join('\n') }] : []),
      ...(bonuses.length ? [{ name: t('giveaways.panel.bonus'), value: bonuses.join('\n') }] : []),
      ...(g.status === 'ended'
        ? [{ name: t('giveaways.panel.winners'), value: g.winners.map(userMention).join(', ') || t('giveaways.panel.noWinners') }]
        : [{ name: t('giveaways.panel.winnerCount'), value: String(g.winnerCount), inline: true }]),
    ])
    .footer(t(g.status === 'cancelled' ? 'giveaways.panel.cancelled' : 'giveaways.panel.footer', { id: g.giveawayId }));
  return panel.row(
    new ButtonBuilder()
      .setCustomId(`giveaway:enter:${g.giveawayId}`)
      .setStyle(ButtonStyle.Success)
      .setLabel(t('giveaways.panel.enter', { count: g.entrants.length }))
      .setDisabled(!running),
  );
}

async function updateMessage(bot: Bot, g: GiveawayDoc): Promise<void> {
  if (!g.messageId) return;
  const channel = bot.client.channels.cache.get(g.channelId);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  const message = await channel.messages.fetch(g.messageId).catch(() => null);
  await message?.edit({ ...(await renderGiveaway(bot, g)).render(), allowedMentions: { parse: [] } }).catch(() => undefined);
}

/** Refreshes the entry count, at most every few seconds so a rush of entries doesn't hit rate limits. */
function scheduleRefresh(bot: Bot, guildId: string, giveawayId: number): void {
  refresh(`${guildId}:${giveawayId}`, async () => {
    const g = await GiveawayModel.findOne({ guildId, giveawayId }).lean<GiveawayDoc>();
    if (g) await updateMessage(bot, g);
  });
}

export async function checkRequirements(bot: Bot, member: GuildMember, g: GiveawayDoc): Promise<void> {
  const r = g.requirements;
  if (r.roleId && !member.roles.cache.has(r.roleId)) throw new UserError('giveaways.errors.role', { role: roleMention(r.roleId) });
  if (r.minAccountDays && Date.now() - member.user.createdTimestamp < r.minAccountDays * DAY) {
    throw new UserError('giveaways.errors.account', { count: r.minAccountDays });
  }
  if (r.minServerDays && Date.now() - (member.joinedTimestamp ?? Date.now()) < r.minServerDays * DAY) {
    throw new UserError('giveaways.errors.server', { count: r.minServerDays });
  }
  if (r.minLevel) {
    const profile = await ProfileModel.findOne({ guildId: member.guild.id, userId: member.id }).lean();
    const level = progressFor(profile?.xp ?? 0, curveOf(bot)).level;
    if (level < r.minLevel) throw new UserError('giveaways.errors.level', { level: r.minLevel, current: level });
  }
}

/** Adds the member to the giveaway, or removes them if they were already in. Returns whether they're in now. */
export async function toggleEntry(bot: Bot, member: GuildMember, giveawayId: number): Promise<boolean> {
  const g = await GiveawayModel.findOne({ guildId: member.guild.id, giveawayId }).lean<GiveawayDoc>();
  if (!g || g.status !== 'running' || g.endsAt.getTime() <= Date.now()) throw new UserError('giveaways.errors.notRunning');
  const entered = g.entrants.includes(member.id);
  if (entered) {
    await GiveawayModel.updateOne({ guildId: g.guildId, giveawayId }, { $pull: { entrants: member.id } });
  } else {
    await checkRequirements(bot, member, g);
    await GiveawayModel.updateOne({ guildId: g.guildId, giveawayId, status: 'running' }, { $addToSet: { entrants: member.id } });
  }
  scheduleRefresh(bot, g.guildId, g.giveawayId);
  return !entered;
}

/** Weighs and draws winners from entrants who are still in the server, skipping `exclude`. */
async function draw(guild: Guild, g: GiveawayDoc, count: number, exclude: readonly string[]): Promise<string[]> {
  const ids = g.entrants.filter((id) => !exclude.includes(id));
  const entrants = [];
  for (let i = 0; i < ids.length; i += 100) {
    const members = await guild.members.fetch({ user: ids.slice(i, i + 100) }).catch(() => null);
    for (const member of members?.values() ?? []) {
      entrants.push({ id: member.id, weight: entriesFor({ boosting: Boolean(member.premiumSince), roles: new Set(member.roles.cache.keys()) }, g.bonus) });
    }
  }
  return pickWinners(entrants, count);
}

async function announce(bot: Bot, g: GiveawayDoc, winners: string[], reroll: boolean): Promise<void> {
  const channel = bot.client.channels.cache.get(g.channelId);
  if (!channel?.isSendable()) return;
  const { t, color } = await translator(bot, g.guildId);
  const text = winners.length
    ? t(reroll ? 'giveaways.announce.reroll' : 'giveaways.announce.won', { winners: winners.map(userMention).join(', '), prize: g.prize })
    : t('giveaways.announce.none', { prize: g.prize });
  await channel
    .send({
      ...bot.panel(color).text(text).render(),
      allowedMentions: { users: winners },
      ...(g.messageId ? { reply: { messageReference: g.messageId, failIfNotExists: false } } : {}),
    })
    .catch(() => undefined);
}

/** Ends a giveaway now. The status update is conditional, so the scheduler and /giveaway end can't both draw. */
export async function endGiveaway(bot: Bot, g: GiveawayDoc): Promise<string[]> {
  const claimed = await GiveawayModel.updateOne({ guildId: g.guildId, giveawayId: g.giveawayId, status: 'running' }, { status: 'ended', endsAt: new Date(Math.min(Date.now(), g.endsAt.getTime())) });
  if (claimed.modifiedCount === 0) return [];
  const guild = bot.client.guilds.cache.get(g.guildId);
  const winners = guild ? await draw(guild, g, g.winnerCount, []) : [];
  await GiveawayModel.updateOne({ guildId: g.guildId, giveawayId: g.giveawayId }, { winners });
  const ended = { ...g, status: 'ended' as const, winners, endsAt: new Date(Math.min(Date.now(), g.endsAt.getTime())) };
  await updateMessage(bot, ended);
  await announce(bot, ended, winners, false);
  return winners;
}

export async function rerollGiveaway(bot: Bot, guild: Guild, g: GiveawayDoc, count: number): Promise<string[]> {
  if (g.status !== 'ended') throw new UserError('giveaways.errors.notEnded');
  const winners = await draw(guild, g, count, g.winners);
  if (winners.length > 0) await GiveawayModel.updateOne({ guildId: g.guildId, giveawayId: g.giveawayId }, { $push: { winners: { $each: winners } } });
  await updateMessage(bot, { ...g, winners: [...g.winners, ...winners] });
  await announce(bot, g, winners, true);
  return winners;
}

export async function cancelGiveaway(bot: Bot, g: GiveawayDoc): Promise<void> {
  const result = await GiveawayModel.updateOne({ guildId: g.guildId, giveawayId: g.giveawayId, status: 'running' }, { status: 'cancelled' });
  if (result.modifiedCount === 0) throw new UserError('giveaways.errors.notRunning');
  await updateMessage(bot, { ...g, status: 'cancelled' });
}

export function startScheduler(bot: Bot): () => void {
  let running = false;
  const tick = async () => {
    if (running || bot.stopping) return;
    running = true;
    try {
      const due = await GiveawayModel.find({ status: 'running', endsAt: { $lte: new Date() } }).limit(20).lean<GiveawayDoc[]>();
      for (const g of due) await endGiveaway(bot, g).catch((err) => bot.logger.warn({ err, giveaway: g.giveawayId }, 'giveaway end failed'));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 15_000);
  void tick();
  return () => clearInterval(timer);
}
