import { ActionRowBuilder, PermissionFlagsBits, RoleSelectMenuBuilder, type MessageActionRowComponentBuilder } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { defineComponent, type SetupStep } from '../../../core/module.js';
import { renderWizard } from '../../core/setup/wizard.js';
import { assertAssignableRole } from '../../../core/permissions.js';
import { rolesSettings } from './settings.js';

const STEP = 'roles.auto';

export const rolesStep: SetupStep = {
  id: 'auto',
  async render(ctx) {
    const s = await ctx.bot.settings.module(ctx.guild.id, rolesSettings);
    const select = (key: 'humanRoles' | 'botRoles') =>
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`roles:setup:${key}`)
          .setPlaceholder(ctx.t(`roles.setup.${key}`))
          .setMinValues(0)
          .setMaxValues(10)
          .setDefaultRoles(s[key].slice(0, 10)),
      );
    return { text: ctx.t('roles.setup.body', { command: ctx.bot.commandMention('rolemenu create') }), rows: [select('humanRoles'), select('botRoles')] };
  },
};

export const rolesSetupComponents = [
  defineComponent({
    kind: 'select',
    id: 'roles:setup',
    permissions: { user: PermissionFlagsBits.ManageRoles },
    async run(ctx, [key]) {
      if (key !== 'humanRoles' && key !== 'botRoles') throw new UserError('errors.expired');
      for (const id of ctx.interaction.values) {
        const role = ctx.guild.roles.cache.get(id);
        if (role) await assertAssignableRole(role, ctx.member);
      }
      await ctx.bot.settings.updateModule(ctx.guild.id, rolesSettings, { [key]: [...ctx.interaction.values] });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
];
