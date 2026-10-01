import { time, TimestampStyles, userMention, type Guild, type User } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { formatDuration } from '../../core/duration.js';
import { nextSequence } from '../../core/models/counter.js';
import type { Panel } from '../../core/ui/panel.js';
import { CaseModel, type CaseDoc, type CaseSource, type CaseType } from './models/case.js';
import { postModLog } from './modlog.js';

const COLORS: Record<CaseType, number> = {
  ban: 0xed4245,
  kick: 0xf0883e,
  timeout: 0xfee75c,
  warn: 0xfaa61a,
  unban: 0x57f287,
  untimeout: 0x57f287,
};

export interface NewCase {
  type: CaseType;
  user: User;
  moderator: User;
  reason: string | null;
  duration?: number | null;
  source?: CaseSource;
}

export async function createCase(bot: Bot, guild: Guild, input: NewCase): Promise<CaseDoc> {
  const duration = input.duration ?? null;
  const caseId = await nextSequence(`case:${guild.id}`);
  const created = await CaseModel.create({
    guildId: guild.id,
    caseId,
    type: input.type,
    userId: input.user.id,
    userTag: input.user.tag,
    moderatorId: input.moderator.id,
    moderatorTag: input.moderator.tag,
    reason: input.reason,
    duration,
    expiresAt: duration ? new Date(Date.now() + duration) : null,
    active: input.type === 'ban' && duration !== null,
    source: input.source ?? 'command',
  });
  const entry = created.toObject();

  const settings = await bot.settings.get(guild.id);
  const message = await postModLog(bot, guild, casePanel(bot, bot.guildLocale(settings), entry));
  if (message) {
    await CaseModel.updateOne({ _id: created._id }, { logChannelId: message.channelId, logMessageId: message.id });
    entry.logChannelId = message.channelId;
    entry.logMessageId = message.id;
  }
  return entry;
}

/** Re-renders the mod log message of an edited case. Silently skips logs that were deleted. */
export async function refreshLogMessage(bot: Bot, guild: Guild, entry: CaseDoc): Promise<void> {
  if (!entry.logChannelId || !entry.logMessageId) return;
  const channel = guild.channels.cache.get(entry.logChannelId);
  if (!channel?.isTextBased()) return;
  const settings = await bot.settings.get(guild.id);
  try {
    const message = await channel.messages.fetch(entry.logMessageId);
    await message.edit(casePanel(bot, bot.guildLocale(settings), entry).render());
  } catch (err) {
    bot.logger.debug({ err, case: entry.caseId }, 'could not edit mod log message');
  }
}

export function casePanel(bot: Bot, locale: string, entry: CaseDoc): Panel {
  const t = (key: string, vars?: Record<string, string | number>) => bot.i18n.t(locale, key, vars);
  const fields = [
    { name: t('moderation.case.user'), value: `${userMention(entry.userId)} ${entry.userTag}\n-# ${entry.userId}`, inline: true },
    { name: t('moderation.case.moderator'), value: `${userMention(entry.moderatorId)} ${entry.moderatorTag}`, inline: true },
    { name: t('moderation.case.date'), value: time(entry.createdAt, TimestampStyles.ShortDateTime), inline: true },
  ];
  if (entry.duration) {
    const until = entry.expiresAt ? ` (${t('moderation.case.ends', { time: time(entry.expiresAt, TimestampStyles.RelativeTime) })})` : '';
    fields.push({ name: t('moderation.case.duration'), value: `${formatDuration(entry.duration)}${until}`, inline: true });
  }
  fields.push({ name: t('moderation.case.reason'), value: entry.reason ?? t('moderation.noReason'), inline: false });

  const panel = bot
    .panel(COLORS[entry.type])
    .title(t('moderation.case.title', { type: t(`moderation.types.${entry.type}`), id: entry.caseId }))
    .fields(fields);
  if (entry.source !== 'command') panel.footer(t(`moderation.sources.${entry.source}`));
  return panel;
}

export function caseLine(bot: Bot, locale: string, entry: CaseDoc): string {
  const reason = entry.reason ?? bot.i18n.t(locale, 'moderation.noReason');
  const short = reason.length > 70 ? `${reason.slice(0, 67)}...` : reason;
  return `**#${entry.caseId}** ${bot.i18n.t(locale, `moderation.types.${entry.type}`)} · ${time(entry.createdAt, TimestampStyles.ShortDate)}\n${short}`;
}
