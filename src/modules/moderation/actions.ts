import { DiscordAPIError, RESTJSONErrorCodes, type Guild, type GuildMember, type User } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { formatDuration } from '../../core/duration.js';
import { UserError } from '../../core/errors.js';
import { createCase } from './cases.js';
import { assertCanModerate, type ModAction } from './hierarchy.js';
import { CaseModel, type CaseDoc, type CaseSource } from './models/case.js';
import { moderationSettings } from './settings.js';

/** Discord's hard limit for timeouts. */
export const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

export interface ActionInput {
  guild: Guild;
  user: User;
  /** The member who issued the action, or null when the bot acts on its own (AutoMod, expiries). */
  moderator: GuildMember | null;
  reason: string | null;
  source?: CaseSource;
}

export interface ActionResult {
  entry: CaseDoc;
  /** true/false when a DM was attempted, null when DMs are off or the user wasn't reachable. */
  dmSent: boolean | null;
}

/*
 * The moderation actions. Commands, AutoMod and expiry timers all go through these so every
 * action gets the same checks, DM, case and mod log entry.
 */

export async function ban(
  bot: Bot,
  input: ActionInput & { duration?: number | null; deleteMessageSeconds?: number },
): Promise<ActionResult> {
  const { guild, user } = input;
  const member = await fetchMember(guild, user.id);
  if (member) await assertCanModerate(member, input.moderator, 'ban');
  if (await isBanned(guild, user.id)) throw new UserError('moderation.errors.alreadyBanned', { user: user.toString() });

  // DM first: once banned, the user shares no server with the bot and can't receive it.
  const dmSent = member ? await notify(bot, input, 'ban', input.duration ?? null) : null;
  await guild.bans.create(user.id, { reason: auditReason(input), deleteMessageSeconds: input.deleteMessageSeconds ?? 0 });
  const entry = await createCase(bot, guild, caseInput(input, 'ban', input.duration ?? null));
  return { entry, dmSent };
}

export async function unban(bot: Bot, input: ActionInput): Promise<ActionResult> {
  const { guild, user } = input;
  if (!(await isBanned(guild, user.id))) throw new UserError('moderation.errors.notBanned', { user: user.toString() });
  await guild.bans.remove(user.id, auditReason(input));
  await CaseModel.updateMany({ guildId: guild.id, userId: user.id, type: 'ban', active: true }, { active: false });
  const entry = await createCase(bot, guild, caseInput(input, 'unban', null));
  return { entry, dmSent: null };
}

export async function kick(bot: Bot, input: ActionInput): Promise<ActionResult> {
  const member = await requireMember(input, 'kick');
  const dmSent = await notify(bot, input, 'kick', null);
  await member.kick(auditReason(input));
  const entry = await createCase(bot, input.guild, caseInput(input, 'kick', null));
  return { entry, dmSent };
}

export async function timeout(bot: Bot, input: ActionInput & { duration: number }): Promise<ActionResult> {
  if (input.duration > MAX_TIMEOUT_MS) throw new UserError('moderation.errors.timeoutTooLong');
  const member = await requireMember(input, 'timeout');
  await member.timeout(input.duration, auditReason(input));
  const dmSent = await notify(bot, input, 'timeout', input.duration);
  const entry = await createCase(bot, input.guild, caseInput(input, 'timeout', input.duration));
  return { entry, dmSent };
}

export async function untimeout(bot: Bot, input: ActionInput): Promise<ActionResult> {
  const member = await requireMember(input, 'timeout');
  if (!member.isCommunicationDisabled()) throw new UserError('moderation.errors.notTimedOut', { user: member.toString() });
  await member.timeout(null, auditReason(input));
  const entry = await createCase(bot, input.guild, caseInput(input, 'untimeout', null));
  return { entry, dmSent: null };
}

export async function warn(bot: Bot, input: ActionInput): Promise<ActionResult> {
  await requireMember(input, 'warn');
  const dmSent = await notify(bot, input, 'warn', null);
  const entry = await createCase(bot, input.guild, caseInput(input, 'warn', null));
  return { entry, dmSent };
}

export async function fetchMember(guild: Guild, userId: string): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch(userId);
  } catch (err) {
    if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMember) return null;
    throw err;
  }
}

async function requireMember(input: ActionInput, action: ModAction): Promise<GuildMember> {
  const member = await fetchMember(input.guild, input.user.id);
  if (!member) throw new UserError('moderation.errors.notMember', { user: input.user.toString() });
  await assertCanModerate(member, input.moderator, action);
  return member;
}

async function isBanned(guild: Guild, userId: string): Promise<boolean> {
  try {
    await guild.bans.fetch({ user: userId, force: true });
    return true;
  } catch (err) {
    if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownBan) return false;
    throw err;
  }
}

function caseInput(input: ActionInput, type: CaseDoc['type'], duration: number | null) {
  return {
    type,
    user: input.user,
    moderator: input.moderator?.user ?? input.guild.client.user,
    reason: input.reason,
    duration,
    source: input.source ?? 'command',
  };
}

function auditReason(input: ActionInput): string {
  const by = input.moderator?.user.tag ?? input.guild.client.user.tag;
  return `${by}: ${input.reason ?? '-'}`.slice(0, 512);
}

async function notify(bot: Bot, input: ActionInput, type: 'ban' | 'kick' | 'timeout' | 'warn', duration: number | null): Promise<boolean | null> {
  const { guild, user } = input;
  const { dmUsers } = await bot.settings.module(guild.id, moderationSettings);
  if (!dmUsers || user.bot) return null;

  const settings = await bot.settings.get(guild.id);
  const locale = bot.guildLocale(settings);
  const t = (key: string, vars?: Record<string, string>) => bot.i18n.t(locale, key, vars);
  const panel = bot
    .panel(settings.color ?? bot.config.bot.color)
    .title(t(`moderation.dm.${type}`, { guild: guild.name }))
    .thumbnail(guild.iconURL({ size: 128 }))
    .fields([
      { name: t('moderation.case.reason'), value: input.reason ?? t('moderation.noReason') },
      ...(duration ? [{ name: t('moderation.case.duration'), value: formatDuration(duration) }] : []),
    ]);

  try {
    await user.send(panel.render());
    return true;
  } catch {
    // Closed DMs are normal and not worth logging.
    return false;
  }
}
