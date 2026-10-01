import { Events } from 'discord.js';
import { defineEvent } from '../../../core/module.js';
import { replyInChat, wantsReply } from '../chat.js';
import { scanMessage, shouldScan } from '../scanner.js';
import { aiSettings } from '../settings.js';

export default defineEvent({
  name: Events.MessageCreate,
  async run(bot, message) {
    if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return;
    const core = await bot.settings.get(message.guildId);
    if (!bot.isEnabled('ai', core)) return;
    const settings = await bot.settings.module(message.guildId, aiSettings);

    // The scanner runs first: a scam image that also mentions the bot shouldn't get a friendly answer.
    if (shouldScan(message, settings, core.staffRoles) && (await scanMessage(bot, message, settings))) return;
    if (wantsReply(message, settings)) await replyInChat(bot, message, settings);
  },
});
