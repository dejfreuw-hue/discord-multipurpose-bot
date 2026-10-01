import { Events, userMention, type Message } from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import { defineEvent } from '../../../core/module.js';
import { judgeCount, parseCount, type CountVerdict } from './logic.js';
import { advanceCount, countingState, resetCount } from './model.js';
import { countingConfig, countingSettings } from './settings.js';

const config = (bot: Bot) => bot.moduleConfig({ name: 'counting', config: countingConfig });

async function notice(message: Message<true>, text: string, deleteAfterMs?: number): Promise<void> {
  const sent = await message.channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => null);
  if (sent && deleteAfterMs) setTimeout(() => void sent.delete().catch(() => undefined), deleteAfterMs).unref();
}

async function fail(bot: Bot, message: Message<true>, verdict: Exclude<CountVerdict, 'ok'>, resetOnFail: boolean): Promise<void> {
  const state = await countingState(message.guildId);
  const t = (key: string, vars: Record<string, string | number>) =>
    bot.i18n.t(bot.guildLocale(bot.settings.peek(message.guildId)), key, vars);
  const reason = t(`counting.fail.${verdict}`, { next: state.current + 1 });

  if (!resetOnFail) {
    await message.delete().catch(() => undefined);
    await notice(message, `${userMention(message.author.id)} ${reason}`, 5000);
    return;
  }
  await resetCount(message.guildId);
  await message.react(config(bot).wrongEmoji).catch(() => undefined);
  await notice(
    message,
    t('counting.fail.reset', { user: userMention(message.author.id), reason, count: state.current, record: state.highScore }),
  );
}

const messageCreate = defineEvent({
  name: Events.MessageCreate,
  async run(bot, message) {
    if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return;
    const core = await bot.settings.get(message.guildId);
    if (!bot.isEnabled('counting', core)) return;
    const settings = await bot.settings.module(message.guildId, countingSettings);
    if (message.channelId !== settings.channelId) return;

    const value = parseCount(message.content);
    if (value === null) {
      if (!settings.allowChat) await message.delete().catch(() => undefined);
      return;
    }

    const before = await countingState(message.guildId);
    let verdict = judgeCount(before, message.author.id, value, settings.allowTwice);
    if (verdict === 'ok' && !(await advanceCount(message.guildId, value, message.author.id, message.id, settings.allowTwice))) {
      // Someone else counted first; judge again against what's stored now.
      verdict = judgeCount(await countingState(message.guildId), message.author.id, value, settings.allowTwice);
      if (verdict === 'ok') verdict = 'wrongNumber';
    }
    if (verdict !== 'ok') return fail(bot, message, verdict, settings.resetOnFail);

    const emoji = value > before.highScore ? config(bot).recordEmoji : config(bot).correctEmoji;
    await message.react(emoji).catch(() => undefined);
  },
});

const messageDelete = defineEvent({
  name: Events.MessageDelete,
  async run(bot, message) {
    if (!message.inGuild()) return;
    const settings = await bot.settings.module(message.guildId, countingSettings);
    if (message.channelId !== settings.channelId) return;
    const state = await countingState(message.guildId);
    if (state.lastMessageId !== message.id || !state.lastUserId) return;
    // Without this, deleting the latest number leaves everyone guessing what comes next.
    const t = bot.i18n.t.bind(bot.i18n, bot.guildLocale(bot.settings.peek(message.guildId)));
    await message.channel
      .send({ content: t('counting.deleted', { user: userMention(state.lastUserId), count: state.current, next: state.current + 1 }), allowedMentions: { parse: [] } })
      .catch(() => undefined);
  },
});

export const countingEvents = [messageCreate, messageDelete];
