import { Events, type Message } from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import { defineEvent } from '../../../core/module.js';
import { checkMessage } from '../check.js';
import { enforce, isExempt } from '../enforce.js';
import { automodSettings } from '../settings.js';

async function inspect(bot: Bot, message: Message, isEdit: boolean): Promise<void> {
  if (!message.inGuild() || message.author.bot || message.webhookId || message.system || !message.member) return;
  const core = await bot.settings.get(message.guildId);
  if (!bot.isEnabled('automod', core)) return;

  const settings = await bot.settings.module(message.guildId, automodSettings);
  if (isExempt(message.member, message.channel, core, settings)) return;

  const violation = await checkMessage(bot, message, settings, isEdit);
  if (violation) await enforce(bot, message, violation, settings);
}

export const messageCreate = defineEvent({
  name: Events.MessageCreate,
  run: (bot, message) => inspect(bot, message, false),
});

// Editing a clean message into an invite or slur is a common way around filters.
export const messageUpdate = defineEvent({
  name: Events.MessageUpdate,
  async run(bot, before, after) {
    if (after.partial || before.content === after.content) return;
    await inspect(bot, after, true);
  },
});
