import { ChannelType, Events, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { assertAssignableRole } from '../../../core/permissions.js';
import { defineCommand, defineEvent, defineModule } from '../../../core/module.js';
import { applyRoles } from '../roles/logic.js';
import { panelFor, verifyComponents } from './flow.js';
import { verificationSettings, type VerificationSettings } from './settings.js';

const command = defineCommand({
  data: new SlashCommandBuilder()
    .setName('verification')
    .setDescription('verification.command.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('settings')
        .setDescription('verification.command.settings')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('verification.command.options.mode')
            .addChoices({ name: 'verification.modes.button', value: 'button' }, { name: 'verification.modes.captcha', value: 'captcha' }),
        )
        .addRoleOption((o) => o.setName('verified_role').setDescription('verification.command.options.verifiedRole'))
        .addRoleOption((o) => o.setName('unverified_role').setDescription('verification.command.options.unverifiedRole'))
        .addIntegerOption((o) => o.setName('min_account_days').setDescription('verification.command.options.minAccountDays').setMinValue(0).setMaxValue(365))
        .addBooleanOption((o) => o.setName('clear_roles').setDescription('verification.command.options.clearRoles')),
    )
    .addSubcommand((s) =>
      s
        .setName('panel')
        .setDescription('verification.command.panel')
        .addChannelOption((o) => o.setName('channel').setDescription('verification.command.options.channel').setRequired(true).addChannelTypes(ChannelType.GuildText)),
    ),
  defer: 'ephemeral',
  permissions: { user: PermissionFlagsBits.ManageGuild, bot: PermissionFlagsBits.ManageRoles },
  async run(ctx) {
    const { options } = ctx.interaction;
    const s = await ctx.bot.settings.module(ctx.guild.id, verificationSettings);

    if (options.getSubcommand() === 'panel') {
      if (!s.verifiedRoleId && !s.unverifiedRoleId) throw new UserError('verification.errors.notSetUp');
      const channel = ctx.guild.channels.cache.get(options.getChannel('channel', true).id);
      if (!channel?.isSendable()) throw new UserError('tickets.errors.panelChannel');
      const message = await channel.send(panelFor(ctx.bot, (k) => ctx.t(k), ctx.color).render());
      await ctx.respond(ctx.successPanel(ctx.t('tickets.panel.sent', { url: message.url })));
      return;
    }

    const patch: Partial<VerificationSettings> = {};
    const mode = options.getString('mode') as VerificationSettings['mode'] | null;
    const verified = options.getRole('verified_role');
    const unverified = options.getRole('unverified_role');
    const days = options.getInteger('min_account_days');
    if (mode) patch.mode = mode;
    if (verified) {
      await assertAssignableRole(ctx.guild.roles.cache.get(verified.id)!, ctx.member);
      patch.verifiedRoleId = verified.id;
    }
    if (unverified) {
      await assertAssignableRole(ctx.guild.roles.cache.get(unverified.id)!, ctx.member);
      patch.unverifiedRoleId = unverified.id;
    }
    if (days !== null) patch.minAccountDays = days;
    if (options.getBoolean('clear_roles')) Object.assign(patch, { verifiedRoleId: null, unverifiedRoleId: null });
    const updated = await ctx.bot.settings.updateModule(ctx.guild.id, verificationSettings, patch);

    const role = (id: string | null) => (id ? `<@&${id}>` : ctx.t('common.none'));
    await ctx.respond(
      ctx
        .panel()
        .title(ctx.t('verification.command.title'))
        .fields([
          { name: ctx.t('verification.command.mode'), value: ctx.t(`verification.modes.${updated.mode}`), inline: true },
          { name: ctx.t('verification.command.verifiedRole'), value: role(updated.verifiedRoleId), inline: true },
          { name: ctx.t('verification.command.unverifiedRole'), value: role(updated.unverifiedRoleId), inline: true },
          { name: ctx.t('verification.command.minAge'), value: updated.minAccountDays ? ctx.t('verification.command.days', { count: updated.minAccountDays }) : ctx.t('common.off') },
        ])
        .footer(ctx.t('verification.command.footer')),
    );
  },
});

// New members get the "unverified" role so channels can be hidden from them until they verify.
const memberAdd = defineEvent({
  name: Events.GuildMemberAdd,
  async run(bot, member) {
    if (member.user.bot || !bot.isEnabled('verification', await bot.settings.get(member.guild.id))) return;
    const s = await bot.settings.module(member.guild.id, verificationSettings);
    if (s.unverifiedRoleId) await applyRoles(member, { add: [s.unverifiedRoleId], remove: [] }, 'not verified yet').catch(() => undefined);
  },
});

export default defineModule({
  name: 'verification',
  toggleable: true,
  intents: [GatewayIntentBits.GuildMembers],
  guildSettings: verificationSettings.guildSettings,
  commands: [command],
  components: verifyComponents,
  events: [memberAdd],
});
