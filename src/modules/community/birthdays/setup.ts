import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { defineComponent, type SetupStep } from '../../../core/module.js';
import { assertAssignableRole } from '../../../core/permissions.js';
import { renderWizard } from '../../core/setup/wizard.js';
import { birthdaySettings } from './settings.js';

const STEP = 'birthdays.channel';
const MANAGE = { user: PermissionFlagsBits.ManageGuild };
const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(c);

export const birthdayStep: SetupStep = {
  id: 'channel',
  async render(ctx) {
    const s = await ctx.bot.settings.module(ctx.guild.id, birthdaySettings);
    const channel = new ChannelSelectMenuBuilder()
      .setCustomId('birthdays:setup:channel')
      .setPlaceholder(ctx.t('birthdays.setup.channelPlaceholder'))
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(0)
      .setMaxValues(1);
    if (s.channelId) channel.setDefaultChannels(s.channelId);
    const role = new RoleSelectMenuBuilder()
      .setCustomId('birthdays:setup:role')
      .setPlaceholder(ctx.t('birthdays.setup.rolePlaceholder'))
      .setMinValues(0)
      .setMaxValues(1);
    if (s.roleId) role.setDefaultRoles(s.roleId);
    return {
      text: ctx.t('birthdays.setup.body', { command: ctx.bot.commandMention('birthday set'), admin: ctx.bot.commandMention('birthdays settings'), timeZone: s.timeZone }),
      rows: [row(channel), row(role)],
    };
  },
};

export const birthdaySetupComponents = [
  defineComponent({
    kind: 'select',
    id: 'birthdays:setup:channel',
    permissions: MANAGE,
    async run(ctx) {
      await ctx.bot.settings.updateModule(ctx.guild.id, birthdaySettings, { channelId: ctx.interaction.values[0] ?? null });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'select',
    id: 'birthdays:setup:role',
    permissions: MANAGE,
    async run(ctx) {
      const roleId = ctx.interaction.values[0] ?? null;
      const role = roleId ? ctx.guild.roles.cache.get(roleId) : null;
      if (role) await assertAssignableRole(role, ctx.member);
      await ctx.bot.settings.updateModule(ctx.guild.id, birthdaySettings, { roleId });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
];
