import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { formatDuration } from '../../../core/duration.js';
import { defineCommand } from '../../../core/module.js';
import { ban, unban } from '../actions.js';
import { confirmation, readDuration, readReason } from '../respond.js';

const BAN = PermissionFlagsBits.BanMembers;

export const banCommand = defineCommand({
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('moderation.ban.description')
    .setDefaultMemberPermissions(BAN)
    .addUserOption((o) => o.setName('user').setDescription('moderation.options.user').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('moderation.options.reason').setMaxLength(400))
    .addStringOption((o) => o.setName('duration').setDescription('moderation.ban.options.duration').setMaxLength(32))
    .addIntegerOption((o) =>
      o
        .setName('delete_messages')
        .setDescription('moderation.ban.options.deleteMessages')
        .addChoices(
          { name: 'moderation.ban.delete.none', value: 0 },
          { name: 'moderation.ban.delete.hour', value: 3600 },
          { name: 'moderation.ban.delete.day', value: 86_400 },
          { name: 'moderation.ban.delete.week', value: 604_800 },
        ),
    ),
  permissions: { user: BAN, bot: BAN, allowStaff: true },
  async run(ctx) {
    const user = ctx.interaction.options.getUser('user', true);
    const duration = readDuration(ctx, 'duration');
    const result = await ban(ctx.bot, {
      guild: ctx.guild,
      user,
      moderator: ctx.member,
      reason: await readReason(ctx),
      duration,
      deleteMessageSeconds: ctx.interaction.options.getInteger('delete_messages') ?? 0,
    });
    const key = duration ? 'moderation.ban.doneTemp' : 'moderation.ban.done';
    await ctx.respond(confirmation(ctx, result, key, { user: user.toString(), duration: duration ? formatDuration(duration) : '' }));
  },
});

export const unbanCommand = defineCommand({
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('moderation.unban.description')
    .setDefaultMemberPermissions(BAN)
    .addUserOption((o) => o.setName('user').setDescription('moderation.unban.options.user').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('moderation.options.reason').setMaxLength(400)),
  permissions: { user: BAN, bot: BAN, allowStaff: true },
  async run(ctx) {
    const user = ctx.interaction.options.getUser('user', true);
    const result = await unban(ctx.bot, { guild: ctx.guild, user, moderator: ctx.member, reason: await readReason(ctx) });
    await ctx.respond(confirmation(ctx, result, 'moderation.unban.done', { user: user.toString() }));
  },
});
