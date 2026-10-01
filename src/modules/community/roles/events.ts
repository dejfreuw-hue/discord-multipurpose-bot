import { Events, type GuildMember, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import { defineEvent } from '../../../core/module.js';
import { applyRoles } from './logic.js';
import { reactionMenus, reactionToggle } from './menus.js';
import { rolesSettings } from './settings.js';

async function giveAutoRoles(bot: Bot, member: GuildMember): Promise<void> {
  if (!bot.isEnabled('roles', await bot.settings.get(member.guild.id))) return;
  const settings = await bot.settings.module(member.guild.id, rolesSettings);
  const roles = member.user.bot ? settings.botRoles : settings.humanRoles;
  if (roles.length > 0) await applyRoles(member, { add: roles, remove: [] }, 'auto-role').catch((err) => bot.logger.warn({ err }, 'auto-role failed'));
}

export const memberAdd = defineEvent({
  name: Events.GuildMemberAdd,
  async run(bot, member) {
    // Members still on the rules screen can't hold roles yet; they get them once they accept.
    if (member.pending) return;
    await giveAutoRoles(bot, member);
  },
});

export const memberUpdate = defineEvent({
  name: Events.GuildMemberUpdate,
  async run(bot, before, after) {
    if (before.pending && !after.pending) await giveAutoRoles(bot, after);
  },
});

async function onReaction(bot: Bot, reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, added: boolean): Promise<void> {
  if (user.bot || !reactionMenus.has(reaction.message.id) || !reaction.message.guild) return;
  const guild = reaction.message.guild;
  if (!bot.isEnabled('roles', await bot.settings.get(guild.id))) return;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (member) await reactionToggle(bot, member, reaction.message.id, reaction.emoji, added).catch((err) => bot.logger.warn({ err }, 'reaction role failed'));
}

export const reactionAdd = defineEvent({
  name: Events.MessageReactionAdd,
  run: (bot, reaction, user) => onReaction(bot, reaction, user, true),
});

export const reactionRemove = defineEvent({
  name: Events.MessageReactionRemove,
  run: (bot, reaction, user) => onReaction(bot, reaction, user, false),
});
