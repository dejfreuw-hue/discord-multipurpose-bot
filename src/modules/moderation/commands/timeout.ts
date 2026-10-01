import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { formatDuration } from '../../../core/duration.js';
import { defineCommand } from '../../../core/module.js';
import { timeout, untimeout } from '../actions.js';
import { confirmation, readDuration, readReason } from '../respond.js';

const MODERATE = PermissionFlagsBits.ModerateMembers;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('moderation.timeout.description')
    .setDefaultMemberPermissions(MODERATE)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('moderation.timeout.add')
        .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true))
        .addStringOption((o) => o.setName('duration').setDescription('moderation.timeout.options.duration').setRequired(true).setMaxLength(32))
        .addStringOption((o) => o.setName('reason').setDescription('moderation.options.reason').setMaxLength(400)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('moderation.timeout.remove')
        .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('moderation.options.reason').setMaxLength(400)),
    ),
  permissions: { user: MODERATE, bot: MODERATE, allowStaff: true },
  async run(ctx) {
    const user = ctx.interaction.options.getUser('user', true);
    const base = { guild: ctx.guild, user, moderator: ctx.member, reason: await readReason(ctx) };

    if (ctx.interaction.options.getSubcommand() === 'remove') {
      const result = await untimeout(ctx.bot, base);
      await ctx.respond(confirmation(ctx, result, 'moderation.timeout.removed', { user: user.toString() }));
      return;
    }
    const duration = readDuration(ctx, 'duration', true);
    const result = await timeout(ctx.bot, { ...base, duration });
    await ctx.respond(confirmation(ctx, result, 'moderation.timeout.done', { user: user.toString(), duration: formatDuration(duration) }));
  },
});
