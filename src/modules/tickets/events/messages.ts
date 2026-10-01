import { Events } from 'discord.js';
import { defineEvent } from '../../../core/module.js';
import { touch, trackedKind, untrackChannel } from '../activity.js';
import { findTicket } from '../lifecycle.js';
import { TicketModel } from '../models.js';
import { NOTE_PREFIX, onDirectMessage, relayToUser } from '../modmail.js';

export const messageCreate = defineEvent({
  name: Events.MessageCreate,
  async run(bot, message) {
    if (message.author.bot || message.system) return;
    if (!message.inGuild()) {
      await onDirectMessage(bot, message);
      return;
    }

    const kind = trackedKind(message.channelId);
    if (!kind) return;
    await touch(bot, message.channelId);
    if (kind !== 'modmail' || message.content.startsWith(NOTE_PREFIX)) return;

    const thread = await findTicket(message.channelId);
    if (thread && !(await relayToUser(bot, thread, message))) {
      const core = await bot.settings.get(message.guildId);
      await message.reply({ content: bot.i18n.t(bot.guildLocale(core), 'tickets.modmail.undelivered'), allowedMentions: { parse: [] } });
    }
  },
});

// A ticket channel deleted by hand is closed without a transcript; there's nothing left to save.
export const channelDelete = defineEvent({
  name: Events.ChannelDelete,
  async run(_bot, channel) {
    if (!trackedKind(channel.id)) return;
    untrackChannel(channel.id);
    await TicketModel.updateOne({ channelId: channel.id, status: 'open' }, { status: 'closed', closedAt: new Date(), closeReason: 'channel deleted' });
  },
});
