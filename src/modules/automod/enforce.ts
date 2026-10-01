import { channelMention, PermissionFlagsBits, userMention, type GuildMember, type GuildTextBasedChannel, type Message } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { formatDuration } from '../../core/duration.js';
import type { GuildSettingsData } from '../../core/guild-settings.js';
import { isStaff } from '../../core/permissions.js';
import { ban, kick, timeout, warn, MAX_TIMEOUT_MS } from '../moderation/actions.js';
import { postModLog } from '../moderation/modlog.js';
import { stepFor } from './escalation.js';
import { automodConfig, type AutomodSettings, type FilterName, type LadderStep } from './settings.js';
import { addStrikes } from './strikes.js';

export interface Violation {
  filter: FilterName;
  /** What triggered it, for the mod log: the word, the domain, the mention count. */
  detail: string;
  /** Other messages to remove along with this one (the rest of a spam burst). */
  related?: { messageId: string; channelId: string }[];
}

/**
 * Message IDs AutoMod deleted itself in the last minute. The ghost ping check skips these,
 * otherwise deleting a mass-mention would be reported as a ghost ping.
 */
export const deletedByAutomod = new Set<string>();

const noticeCooldown = new Map<string, number>();

export function isExempt(
  member: GuildMember,
  channel: GuildTextBasedChannel,
  core: GuildSettingsData,
  settings: AutomodSettings,
): boolean {
  if (member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (settings.exemptStaff && isStaff(member, core.staffRoles)) return true;
  if (settings.whitelistRoles.some((id) => member.roles.cache.has(id))) return true;

  // A whitelisted category covers its channels, and a whitelisted channel covers its threads.
  const ids = [channel.id, channel.parentId];
  if (channel.isThread()) ids.push(channel.parent?.parentId ?? null);
  return ids.some((id) => id !== null && settings.whitelistChannels.includes(id));
}

export async function enforce(
  bot: Bot,
  message: Message<true>,
  violation: Violation,
  settings: AutomodSettings,
  options: { alreadyDeleted?: boolean } = {},
): Promise<void> {
  const { guild, author } = message;
  const member = message.member;
  if (!member) return;
  const core = await bot.settings.get(guild.id);
  const locale = bot.guildLocale(core);
  const t = (key: string, vars?: Record<string, string | number>) => bot.i18n.t(locale, key, vars);

  if (!options.alreadyDeleted) await removeMessages(bot, message, violation);

  const points = settings.filters[violation.filter].strikes;
  const { before, after } = await addStrikes(guild.id, author.id, violation.filter, points, settings.strikeDecay);
  const step = stepFor(settings.ladder, before, after);

  if (!options.alreadyDeleted && settings.notify && message.channel.isSendable() && Date.now() - (noticeCooldown.get(author.id) ?? 0) > 5000) {
    if (noticeCooldown.size > 5000) noticeCooldown.clear();
    noticeCooldown.set(author.id, Date.now());
    const panel = bot.panel(core.color ?? bot.config.bot.color).text(`${author}, ${t(`automod.notices.${violation.filter}`)}`);
    const notice = await message.channel.send({ ...panel.render(), allowedMentions: { users: [author.id] } }).catch(() => null);
    const seconds = bot.moduleConfig({ name: 'automod', config: automodConfig }).noticeSeconds;
    if (notice && seconds > 0) setTimeout(() => void notice.delete().catch(() => undefined), seconds * 1000).unref();
  }

  const reason = t('automod.reason', { filter: t(`automod.filters.${violation.filter}`), strikes: after });
  if (step) await punish(bot, member, step, reason);

  await postModLog(
    bot,
    guild,
    bot
      .panel(0xfaa61a)
      .title(t('automod.log.title', { filter: t(`automod.filters.${violation.filter}`) }))
      .fields([
        { name: t('moderation.case.user'), value: `${userMention(author.id)} ${author.tag}`, inline: true },
        { name: t('automod.log.channel'), value: channelMention(message.channelId), inline: true },
        { name: t('automod.log.strikes'), value: points > 0 ? `${before} -> ${after}` : String(after), inline: true },
        { name: t('automod.log.trigger'), value: violation.detail.slice(0, 200) },
        ...(message.content ? [{ name: t('automod.log.content'), value: `>>> ${message.content.slice(0, 900)}` }] : []),
        ...(step ? [{ name: t('automod.log.punishment'), value: describeStep(t, step) }] : []),
      ]),
  );
}

export function describeStep(t: (key: string, vars?: Record<string, string | number>) => string, step: LadderStep): string {
  const action = t(`automod.actions.${step.action}`);
  return step.duration ? `${action} (${formatDuration(step.duration)})` : action;
}

async function removeMessages(bot: Bot, message: Message<true>, violation: Violation): Promise<void> {
  // Spam bursts often hit several channels at once, so group the messages by channel.
  const byChannel = new Map<string, Set<string>>([[message.channelId, new Set([message.id])]]);
  for (const { channelId, messageId } of violation.related ?? []) {
    if (!byChannel.has(channelId)) byChannel.set(channelId, new Set());
    byChannel.get(channelId)!.add(messageId);
  }
  const all = [...byChannel.values()].flatMap((ids) => [...ids]);
  for (const id of all) deletedByAutomod.add(id);
  setTimeout(() => all.forEach((id) => deletedByAutomod.delete(id)), 60_000).unref();

  const me = message.guild.members.me;
  for (const [channelId, ids] of byChannel) {
    const channel = message.guild.channels.cache.get(channelId) ?? message.channel;
    if (!me || !channel.isTextBased() || !channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)) {
      bot.logger.debug({ guild: message.guildId, channel: channelId }, 'automod cannot delete messages here');
      continue;
    }
    try {
      if (ids.size > 1) await channel.bulkDelete([...ids], true);
      else await channel.messages.delete([...ids][0]!);
    } catch (err) {
      bot.logger.debug({ err, channel: channelId }, 'automod delete failed');
    }
  }
}

async function punish(bot: Bot, member: GuildMember, step: LadderStep, reason: string): Promise<void> {
  const input = { guild: member.guild, user: member.user, moderator: null, reason, source: 'automod' as const };
  try {
    switch (step.action) {
      case 'warn':
        await warn(bot, input);
        break;
      case 'timeout':
        await timeout(bot, { ...input, duration: Math.min(step.duration ?? 600_000, MAX_TIMEOUT_MS) });
        break;
      case 'kick':
        await kick(bot, input);
        break;
      case 'ban':
        await ban(bot, { ...input, duration: step.duration });
        break;
    }
  } catch (err) {
    // Usually hierarchy: the member is above the bot. The violation is still logged.
    bot.logger.info({ err: err instanceof Error ? err.message : err, guild: member.guild.id, user: member.id }, 'automod punishment skipped');
  }
}
