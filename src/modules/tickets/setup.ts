import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { defineComponent, type SetupStep } from '../../core/module.js';
import { renderWizard } from '../core/setup/wizard.js';
import { ticketSettings } from './settings.js';

const MANAGE = { user: PermissionFlagsBits.ManageGuild };
const STEP = 'tickets.basics';

const row = (component: MessageActionRowComponentBuilder) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(component);

export const ticketsStep: SetupStep = {
  id: 'basics',
  async render(ctx) {
    const s = await ctx.bot.settings.module(ctx.guild.id, ticketSettings);
    const transcripts = new ChannelSelectMenuBuilder()
      .setCustomId('tickets:setup:transcripts')
      .setPlaceholder(ctx.t('tickets.setup.transcriptsPlaceholder'))
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(1);
    if (s.transcriptChannelId) transcripts.setDefaultChannels(s.transcriptChannelId);
    const category = new ChannelSelectMenuBuilder()
      .setCustomId('tickets:setup:category')
      .setPlaceholder(ctx.t('tickets.setup.categoryPlaceholder'))
      .setChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0)
      .setMaxValues(1);
    if (s.categoryId) category.setDefaultChannels(s.categoryId);
    const roles = new RoleSelectMenuBuilder()
      .setCustomId('tickets:setup:roles')
      .setPlaceholder(ctx.t('tickets.setup.rolesPlaceholder'))
      .setMinValues(0)
      .setMaxValues(10)
      .setDefaultRoles(s.supportRoles.slice(0, 10));
    const modmail = new ButtonBuilder()
      .setCustomId('tickets:setup:modmail')
      .setStyle(s.modmail.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setLabel(`${ctx.t('tickets.setup.modmail')}: ${ctx.t(s.modmail.enabled ? 'common.on' : 'common.off')}`);

    return {
      text: ctx.t('tickets.setup.body', { command: ctx.bot.commandMention('tickets panel create') }),
      rows: [row(transcripts), row(category), row(roles), row(modmail)],
    };
  },
};

export const ticketsSetupComponents = [
  defineComponent({
    kind: 'select',
    id: 'tickets:setup:transcripts',
    permissions: MANAGE,
    async run(ctx) {
      await ctx.bot.settings.updateModule(ctx.guild.id, ticketSettings, { transcriptChannelId: ctx.interaction.values[0] ?? null });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'select',
    id: 'tickets:setup:category',
    permissions: MANAGE,
    async run(ctx) {
      await ctx.bot.settings.updateModule(ctx.guild.id, ticketSettings, { categoryId: ctx.interaction.values[0] ?? null });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'select',
    id: 'tickets:setup:roles',
    permissions: MANAGE,
    async run(ctx) {
      await ctx.bot.settings.updateModule(ctx.guild.id, ticketSettings, { supportRoles: [...ctx.interaction.values] });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'button',
    id: 'tickets:setup:modmail',
    permissions: MANAGE,
    async run(ctx) {
      const s = await ctx.bot.settings.module(ctx.guild.id, ticketSettings);
      await ctx.bot.settings.updateModule(ctx.guild.id, ticketSettings, { modmail: { ...s.modmail, enabled: !s.modmail.enabled } });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
];
