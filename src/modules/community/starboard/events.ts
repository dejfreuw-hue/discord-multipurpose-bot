import { Events, type MessageReaction, type PartialMessageReaction } from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import { emojiKey, reactionKey } from '../../../core/emoji.js';
import { defineEvent } from '../../../core/module.js';
import { syncStarboard, watchesChannel } from './board.js';
import { StarEntryModel } from './model.js';
import { starboardSettings } from './settings.js';

async function onReaction(bot: Bot, reaction: MessageReaction | PartialMessageReaction): Promise<void> {
  const { message } = reaction;
  if (!message.inGuild() || !(await watchesChannel(bot, message.channel))) return;
  const settings = await bot.settings.module(message.guildId, starboardSettings);
  if (reactionKey(reaction.emoji) !== emojiKey(settings.emoji)) return;
  syncStarboard(bot, message.guild, message.channelId, message.id);
}

const reactionAdd = defineEvent({
  name: Events.MessageReactionAdd,
  run: (bot, reaction) => onReaction(bot, reaction),
});

const reactionRemove = defineEvent({
  name: Events.MessageReactionRemove,
  run: (bot, reaction) => onReaction(bot, reaction),
});

const reactionRemoveEmoji = defineEvent({
  name: Events.MessageReactionRemoveEmoji,
  run: (bot, reaction) => onReaction(bot, reaction),
});

const reactionRemoveAll = defineEvent({
  name: Events.MessageReactionRemoveAll,
  async run(bot, message) {
    if (!message.inGuild() || !(await watchesChannel(bot, message.channel))) return;
    syncStarboard(bot, message.guild, message.channelId, message.id);
  },
});

const messageDelete = defineEvent({
  name: Events.MessageDelete,
  async run(bot, message) {
    if (!message.inGuild()) return;
    // Cheap check first: most deleted messages were never starred.
    if (!(await StarEntryModel.exists({ guildId: message.guildId, messageId: message.id }))) return;
    syncStarboard(bot, message.guild, message.channelId, message.id);
  },
});

export const starboardEvents = [reactionAdd, reactionRemove, reactionRemoveEmoji, reactionRemoveAll, messageDelete];
