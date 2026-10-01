import { PermissionFlagsBits, roleMention, SlashCommandBuilder, time, TimestampStyles, userMention } from 'discord.js';
import { formatDuration } from '../../../core/duration.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand } from '../../../core/module.js';
import { fetchMember } from '../actions.js';
import { assertAssignableRole } from '../../../core/permissions.js';
import { TempRoleModel } from '../models/temp-role.js';
import { postModLog } from '../modlog.js';
import { readDuration, readReason } from '../respond.js';

const MANAGE_ROLES = PermissionFlagsBits.ManageRoles;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('temprole')
    .setDescription('moderation.temprole.description')
    .setDefaultMemberPermissions(MANAGE_ROLES)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('moderation.temprole.add')
        .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('moderation.temprole.options.role').setRequired(true))
        .addStringOption((o) => o.setName('duration').setDescription('moderation.temprole.options.duration').setRequired(true).setMaxLength(32))
        .addStringOption((o) => o.setName('reason').setDescription('moderation.options.reason').setMaxLength(400)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('moderation.temprole.remove')
        .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('moderation.temprole.options.role').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('moderation.temprole.list')
        .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true)),
    ),
  permissions: { user: MANAGE_ROLES, bot: MANAGE_ROLES, allowStaff: true },
  async run(ctx) {
    const { options } = ctx.interaction;
    const user = options.getUser('user', true);
    const sub = options.getSubcommand();

    if (sub === 'list') {
      const entries = await TempRoleModel.find({ guildId: ctx.guild.id, userId: user.id }).sort({ expiresAt: 1 }).lean();
      if (entries.length === 0) throw new UserError('moderation.temprole.none', { user: user.toString() });
      const lines = entries.map((e) =>
        ctx.t('moderation.temprole.line', { role: roleMention(e.roleId), time: time(e.expiresAt, TimestampStyles.RelativeTime) }),
      );
      await ctx.respond(ctx.panel().title(ctx.t('moderation.temprole.listTitle')).text(user.toString(), lines.join('\n')));
      return;
    }

    const role = options.getRole('role', true);
    const member = await fetchMember(ctx.guild, user.id);
    if (!member) throw new UserError('moderation.errors.notMember', { user: user.toString() });
    await assertAssignableRole(role, ctx.member);
    const audit = `${ctx.interaction.user.tag}: temprole`;

    if (sub === 'remove') {
      const removed = await TempRoleModel.deleteOne({ guildId: ctx.guild.id, userId: user.id, roleId: role.id });
      if (removed.deletedCount === 0) throw new UserError('moderation.temprole.notTemporary', { user: user.toString(), role: role.toString() });
      if (member.roles.cache.has(role.id)) await member.roles.remove(role.id, audit);
      await ctx.respond(ctx.successPanel(ctx.t('moderation.temprole.removed', { user: user.toString(), role: role.toString() })));
      return;
    }

    const duration = readDuration(ctx, 'duration', true);
    const reason = await readReason(ctx);
    const expiresAt = new Date(Date.now() + duration);
    // Re-running the command on the same member and role extends the existing entry.
    await TempRoleModel.updateOne(
      { guildId: ctx.guild.id, userId: user.id, roleId: role.id },
      { moderatorId: ctx.member.id, reason, expiresAt },
      { upsert: true },
    );
    if (!member.roles.cache.has(role.id)) await member.roles.add(role.id, audit);

    const vars = {
      user: user.toString(),
      role: role.toString(),
      duration: formatDuration(duration),
      time: time(expiresAt, TimestampStyles.RelativeTime),
    };
    await ctx.respond(ctx.successPanel(ctx.t('moderation.temprole.added', vars)));
    await postModLog(
      ctx.bot,
      ctx.guild,
      ctx
        .panel()
        .title(ctx.t('moderation.temprole.logTitle'))
        .text(ctx.t('moderation.temprole.log', { ...vars, moderator: userMention(ctx.member.id) }), reason ? `${ctx.t('moderation.case.reason')}: ${reason}` : null),
    );
  },
});
