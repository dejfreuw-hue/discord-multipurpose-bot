import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../../core/module.js';
import { kick } from '../actions.js';
import { confirmation, readReason } from '../respond.js';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('moderation.kick.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('moderation.options.reason').setMaxLength(400)),
  permissions: { user: PermissionFlagsBits.KickMembers, bot: PermissionFlagsBits.KickMembers, allowStaff: true },
  async run(ctx) {
    const user = ctx.interaction.options.getUser('user', true);
    const result = await kick(ctx.bot, { guild: ctx.guild, user, moderator: ctx.member, reason: await readReason(ctx) });
    await ctx.respond(confirmation(ctx, result, 'moderation.kick.done', { user: user.toString() }));
  },
});
