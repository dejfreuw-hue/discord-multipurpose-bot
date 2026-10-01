import { ButtonBuilder, ButtonStyle, time, TimestampStyles, userMention, type MessageCreateOptions } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { claimReminder, ReminderModel, type ReminderDoc } from './model.js';
import { isLate, nextOccurrence } from './schedule.js';

function reminderMessage(bot: Bot, doc: ReminderDoc, now: Date, locale: string, inChannel: boolean): MessageCreateOptions {
  const t = (key: string, vars?: Record<string, string | number>) => bot.i18n.t(locale, key, vars);
  const panel = bot.panel().text(
    `${inChannel ? `${userMention(doc.userId)} ` : ''}**${t('reminders.deliver.title')}**`,
    doc.text,
    isLate(doc.dueAt, now) ? `-# ${t('reminders.deliver.late', { time: time(doc.dueAt, TimestampStyles.RelativeTime) })}` : null,
    doc.repeatMs ? `-# ${t('reminders.deliver.repeats', { time: time(nextOccurrence(doc.dueAt, doc.repeatMs, now), TimestampStyles.RelativeTime) })}` : null,
  );
  if (!doc.repeatMs) {
    const id = doc._id.toString();
    panel.row(
      new ButtonBuilder().setCustomId(`reminders:snooze:${id}:10`).setStyle(ButtonStyle.Secondary).setLabel(t('reminders.deliver.snooze10')),
      new ButtonBuilder().setCustomId(`reminders:snooze:${id}:60`).setStyle(ButtonStyle.Secondary).setLabel(t('reminders.deliver.snooze60')),
    );
  }
  // Only ping the owner, whatever the reminder text contains.
  return { ...panel.render(), allowedMentions: { users: [doc.userId] } };
}

async function send(bot: Bot, doc: ReminderDoc, now: Date): Promise<boolean> {
  const guild = doc.guildId ? bot.client.guilds.cache.get(doc.guildId) : undefined;
  const channel = doc.channelId ? guild?.channels.cache.get(doc.channelId) : undefined;

  if (channel?.isSendable()) {
    const sent = await channel.send(reminderMessage(bot, doc, now, doc.locale, true)).catch(() => null);
    if (sent) return true;
  }
  // DMs are the fallback when the channel is gone or the bot can't post there anymore.
  const user = await bot.client.users.fetch(doc.userId).catch(() => null);
  const dm = await user?.send(reminderMessage(bot, doc, now, doc.locale, false)).catch(() => null);
  return Boolean(dm);
}

export async function deliverDue(bot: Bot, now: Date): Promise<void> {
  const due = await ReminderModel.find({ done: false, dueAt: { $lte: now } }).sort({ dueAt: 1 }).limit(50).lean<ReminderDoc[]>();
  for (const doc of due) {
    const next = doc.repeatMs ? nextOccurrence(doc.dueAt, doc.repeatMs, now) : null;
    if (!(await claimReminder(doc, next, now))) continue;
    const delivered = await send(bot, doc, now);
    if (!delivered) bot.logger.debug({ user: doc.userId, reminder: doc.number }, 'reminder could not be delivered');
  }
}

/** Polls for due reminders; returns a function that stops it. */
export function startReminderClock(bot: Bot, intervalMs = 10_000): () => void {
  let running = false;
  const tick = async () => {
    if (running || bot.stopping) return;
    running = true;
    try {
      await deliverDue(bot, new Date());
    } catch (err) {
      bot.logger.error({ err }, 'reminder check failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
