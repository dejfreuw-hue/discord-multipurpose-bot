import { userMention, type Guild } from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import { isBirthdayToday, localTime, possibleBirthdays } from './dates.js';
import { BirthdayModel, type BirthdayDoc } from './model.js';
import { birthdaySettings } from './settings.js';

export function fillBirthday(template: string, vars: { user: string; username: string; server: string; age: number | null }): string {
  return template
    .replace(/\{user\}/g, vars.user)
    .replace(/\{username\}/g, vars.username)
    .replace(/\{server\}/g, vars.server)
    .replace(/\{age\}/g, vars.age === null ? '' : String(vars.age));
}

async function announce(bot: Bot, guild: Guild, doc: BirthdayDoc, age: number | null): Promise<void> {
  const settings = await bot.settings.module(guild.id, birthdaySettings);
  const member = await guild.members.fetch(doc.userId).catch(() => null);
  if (!member) return;

  // The role was checked when it was configured; if it moved above the bot since, skip it quietly.
  if (settings.roleId) await member.roles.add(settings.roleId, 'Birthday').catch(() => undefined);

  const channel = settings.channelId ? guild.channels.cache.get(settings.channelId) : null;
  if (!channel?.isSendable()) return;
  const core = await bot.settings.get(guild.id);
  const vars = { user: userMention(member.id), username: member.displayName, server: guild.name, age };
  const text = settings.message
    ? fillBirthday(settings.message, vars)
    : bot.i18n.t(bot.guildLocale(core), age === null ? 'birthdays.announce.plain' : 'birthdays.announce.age', { ...vars, age: age ?? 0 });
  await channel.send({ ...bot.panel(core.color ?? undefined).text(text).render(), allowedMentions: { users: [member.id] } });
}

async function celebrateDue(bot: Bot, now: Date): Promise<void> {
  const candidates = await BirthdayModel.find({ $or: possibleBirthdays(now) }).lean<BirthdayDoc[]>();
  for (const doc of candidates) {
    const guild = bot.client.guilds.cache.get(doc.guildId);
    if (!guild || !bot.isEnabled('birthdays', await bot.settings.get(guild.id))) continue;
    const settings = await bot.settings.module(guild.id, birthdaySettings);
    const local = localTime(now, doc.timeZone ?? settings.timeZone);
    if (!isBirthdayToday(doc.month, doc.day, local) || doc.celebratedYear === local.year) continue;

    // The role stays until the end of the member's own day.
    const roleUntil = new Date(now.getTime() + (24 * 60 - local.minutes) * 60_000);
    const claimed = await BirthdayModel.updateOne(
      { guildId: doc.guildId, userId: doc.userId, celebratedYear: { $ne: local.year } },
      { celebratedYear: local.year, roleUntil: settings.roleId ? roleUntil : null },
    );
    if (claimed.modifiedCount === 0) continue;
    await announce(bot, guild, doc, doc.year ? local.year - doc.year : null).catch((err: unknown) =>
      bot.logger.warn({ err, guildId: guild.id }, 'birthday announcement failed'),
    );
  }
}

async function removeExpiredRoles(bot: Bot, now: Date): Promise<void> {
  const expired = await BirthdayModel.find({ roleUntil: { $ne: null, $lte: now } }).lean<BirthdayDoc[]>();
  for (const doc of expired) {
    await BirthdayModel.updateOne({ guildId: doc.guildId, userId: doc.userId }, { roleUntil: null });
    const guild = bot.client.guilds.cache.get(doc.guildId);
    if (!guild) continue;
    const { roleId } = await bot.settings.module(guild.id, birthdaySettings);
    if (!roleId) continue;
    const member = await guild.members.fetch(doc.userId).catch(() => null);
    await member?.roles.remove(roleId, 'Birthday is over').catch(() => undefined);
  }
}

export async function checkBirthdays(bot: Bot, now: Date): Promise<void> {
  await removeExpiredRoles(bot, now);
  await celebrateDue(bot, now);
}

/** Checks every few minutes; returns a function that stops it. */
export function startBirthdayClock(bot: Bot, intervalMs = 5 * 60_000): () => void {
  const run = () => void checkBirthdays(bot, new Date()).catch((err: unknown) => bot.logger.error({ err }, 'birthday check failed'));
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
