import { userMention, type TextChannel } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { untrackChannel } from './activity.js';
import { closeTicket } from './lifecycle.js';
import { TicketModel, type TicketDoc } from './models.js';
import { ticketSettings } from './settings.js';

const HOUR = 3_600_000;

/** Reminds owners of quiet tickets and closes abandoned ones, per each server's settings. */
export function startInactivityLoop(bot: Bot, intervalMinutes: number): () => void {
  let running = false;
  const tick = async () => {
    if (running || bot.stopping) return;
    running = true;
    try {
      await checkTickets(bot);
    } catch (err) {
      bot.logger.error({ err }, 'ticket inactivity check failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMinutes * 60_000);
  return () => clearInterval(timer);
}

async function checkTickets(bot: Bot): Promise<void> {
  // Nothing can be due before an hour of silence, since both settings are in whole hours.
  const quiet = await TicketModel.find({ status: 'open', kind: 'ticket', lastActivityAt: { $lte: new Date(Date.now() - HOUR) } })
    .limit(200)
    .lean<TicketDoc[]>();

  for (const ticket of quiet) {
    const guild = bot.client.guilds.cache.get(ticket.guildId);
    if (!guild) continue;
    const channel = guild.channels.cache.get(ticket.channelId) as TextChannel | undefined;
    if (!channel) {
      await TicketModel.updateOne({ channelId: ticket.channelId }, { status: 'closed', closedAt: new Date(), closeReason: 'channel deleted' });
      untrackChannel(ticket.channelId);
      continue;
    }

    const core = await bot.settings.get(guild.id);
    if (!bot.isEnabled('tickets', core)) continue;
    const settings = await bot.settings.module(guild.id, ticketSettings);
    const t = (key: string, vars?: Record<string, string | number>) => bot.i18n.t(bot.guildLocale(core), key, vars);
    const idleHours = (Date.now() - ticket.lastActivityAt.getTime()) / HOUR;

    try {
      if (settings.autoCloseHours > 0 && idleHours >= settings.autoCloseHours) {
        await closeTicket(bot, channel, ticket, bot.client.user!, t('tickets.inactivity.closeReason', { hours: settings.autoCloseHours }));
      } else if (settings.reminderHours > 0 && idleHours >= settings.reminderHours && !ticket.reminderSentAt) {
        const closing = settings.autoCloseHours > 0 ? t('tickets.inactivity.closesIn', { hours: Math.ceil(settings.autoCloseHours - idleHours) }) : '';
        const panel = bot.panel(core.color ?? bot.config.bot.color).text(`${userMention(ticket.ownerId)} ${t('tickets.inactivity.reminder')} ${closing}`.trim());
        await channel.send({ ...panel.render(), allowedMentions: { users: [ticket.ownerId] } });
        await TicketModel.updateOne({ channelId: channel.id }, { reminderSentAt: new Date() });
      }
    } catch (err) {
      bot.logger.warn({ err, guild: guild.id, ticket: ticket.ticketId }, 'ticket inactivity action failed');
    }
  }
}
