import { Events, roleMention, userMention } from 'discord.js';
import { defineEvent } from '../../../core/module.js';
import { deletedByAutomod, enforce, isExempt } from '../enforce.js';
import { automodSettings } from '../settings.js';

// Only works for messages still in the cache, which covers the "ping and delete right away"
// case this is meant for. Messages from before a restart are partial and skipped.
export default defineEvent({
  name: Events.MessageDelete,
  async run(bot, message) {
    if (message.partial || !message.inGuild() || message.author.bot || !message.member) return;
    if (deletedByAutomod.has(message.id)) return;

    const core = await bot.settings.get(message.guildId);
    if (!bot.isEnabled('automod', core)) return;
    const settings = await bot.settings.module(message.guildId, automodSettings);
    const filter = settings.filters.ghostPing;
    if (!filter.enabled || Date.now() - message.createdTimestamp > filter.seconds * 1000) return;
    if (isExempt(message.member, message.channel, core, settings)) return;

    const users = message.mentions.users.filter((u) => !u.bot && u.id !== message.author.id);
    const roles = message.mentions.roles;
    if (users.size === 0 && roles.size === 0) return;

    const mentioned = [...users.keys()].map(userMention).concat([...roles.keys()].map(roleMention));
    const t = (key: string, vars?: Record<string, string>) => bot.i18n.t(bot.guildLocale(core), key, vars);
    if (message.channel.isSendable()) {
      const panel = bot
        .panel(core.color ?? bot.config.bot.color)
        .title(t('automod.ghostPing.title'))
        .text(t('automod.ghostPing.body', { author: userMention(message.author.id), mentions: mentioned.join(', ') }))
        .text(message.content ? `>>> ${message.content.slice(0, 500)}` : null);
      await message.channel.send({ ...panel.render(), allowedMentions: { parse: [] } }).catch(() => undefined);
    }

    if (filter.strikes > 0) {
      await enforce(bot, message, { filter: 'ghostPing', detail: mentioned.join(', ') }, settings, { alreadyDeleted: true });
    }
  },
});
