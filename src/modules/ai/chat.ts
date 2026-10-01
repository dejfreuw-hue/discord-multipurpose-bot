import type { Message } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { UserError } from '../../core/errors.js';
import { buildConversation, splitReply, systemPrompt, type HistoryMessage } from './conversation.js';
import { checkLimits, complete, isBlacklisted, personaFor, providerFor } from './engine.js';
import type { AiSettings } from './settings.js';

/** Whether the bot should answer this message: an AI channel, a mention, or a reply to the bot. */
export function wantsReply(message: Message<true>, settings: AiSettings): boolean {
  const botId = message.client.user.id;
  if (settings.channels.includes(message.channelId)) return true;
  if (!settings.replyToMentions) return false;
  return message.mentions.users.has(botId) || message.mentions.repliedUser?.id === botId;
}

async function history(message: Message<true>, limit: number): Promise<HistoryMessage[]> {
  const botId = message.client.user.id;
  const botName = message.guild.members.me?.displayName;
  const earlier = limit > 0 ? await message.channel.messages.fetch({ limit, before: message.id }).catch(() => null) : null;
  const messages = [...(earlier?.values() ?? [])].reverse();
  messages.push(message);
  return messages
    .filter((m) => !m.author.bot || m.author.id === botId)
    .map((m) => ({
      authorName: m.member?.displayName ?? m.author.displayName,
      // cleanContent turns <@id> into @name, which the model can read. Pinging the bot itself
      // is just how people get its attention, so that part is dropped.
      content: (botName ? m.cleanContent.replaceAll(`@${botName}`, '') : m.cleanContent).trim(),
      fromBot: m.author.id === botId,
    }));
}

export async function replyInChat(bot: Bot, message: Message<true>, settings: AiSettings): Promise<void> {
  if (!message.member || isBlacklisted(message.member, settings)) return;

  const send = (text: string, ping = false) =>
    message.reply({ content: text, allowedMentions: { parse: [], repliedUser: ping } }).catch(() => undefined);

  try {
    await checkLimits(bot, message.guild, message.author.id, settings);
    const configured = providerFor(bot, settings);
    if (message.channel.isSendable()) await message.channel.sendTyping().catch(() => undefined);

    const messages = buildConversation(await history(message, settings.history));
    if (messages.length === 0) return;
    const text = await complete(bot, message.guild, configured, {
      system: systemPrompt({ persona: personaFor(settings), botName: bot.config.bot.name, guildName: message.guild.name }),
      messages,
    });

    const [first, ...rest] = splitReply(text);
    if (!first) return;
    await send(first, true);
    for (const chunk of rest) {
      if (message.channel.isSendable()) await message.channel.send({ content: chunk, allowedMentions: { parse: [] } });
    }
  } catch (err) {
    if (!(err instanceof UserError)) throw err;
    const core = await bot.settings.get(message.guildId);
    await send(bot.i18n.t(bot.guildLocale(core), err.key, err.vars));
  }
}
