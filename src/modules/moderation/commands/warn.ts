import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../../core/module.js';
import { warn } from '../actions.js';
import { CaseModel } from '../models/case.js';
import { confirmation, readReason } from '../respond.js';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('moderation.warn.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('moderation.options.reason').setMaxLength(400)),
  permissions: { user: PermissionFlagsBits.ModerateMembers, allowStaff: true },
  async run(ctx) {
    const user = ctx.interaction.options.getUser('user', true);
    const result = await warn(ctx.bot, { guild: ctx.guild, user, moderator: ctx.member, reason: await readReason(ctx) });
    const count = await CaseModel.countDocuments({ guildId: ctx.guild.id, userId: user.id, type: 'warn' });
    await ctx.respond(confirmation(ctx, result, 'moderation.warn.done', { user: user.toString(), count }));
  },
});
