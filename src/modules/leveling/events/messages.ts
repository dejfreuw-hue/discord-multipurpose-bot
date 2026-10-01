import { Events } from 'discord.js';
import { defineEvent } from '../../../core/module.js';
import { messageXp } from '../curve.js';
import { levelingSettings } from '../settings.js';
import { grantXp, isIgnored, multiplierFor } from '../xp.js';

const lastAward = new Map<string, number>();

export default defineEvent({
  name: Events.MessageCreate,
  async run(bot, message) {
    if (!message.inGuild() || message.author.bot || message.webhookId || message.system || !message.member) return;
    const core = await bot.settings.get(message.guildId);
    if (!bot.isEnabled('leveling', core)) return;
    const settings = await bot.settings.module(message.guildId, levelingSettings);
    if (!settings.text.enabled) return;

    const key = `${message.guildId}:${message.author.id}`;
    const now = Date.now();
    if (now - (lastAward.get(key) ?? 0) < settings.text.cooldownSeconds * 1000) return;
    if (isIgnored(message.member, message.channelId, message.channel.parentId, settings)) return;

    lastAward.set(key, now);
    if (lastAward.size > 50_000) {
      for (const [k, at] of lastAward) if (now - at > 3_600_000) lastAward.delete(k);
    }
    const amount = messageXp(settings.text.min, settings.text.max, multiplierFor(message.member, settings));
    await grantXp(bot, message.member, amount, 'message', message.channel);
  },
});
