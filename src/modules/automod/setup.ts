import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { defineComponent, type SetupStep } from '../../core/module.js';
import { renderWizard } from '../core/setup/wizard.js';
import { automodSettings, FILTERS } from './settings.js';

const MANAGE = { user: PermissionFlagsBits.ManageGuild };
const STEP = 'automod.filters';
const MAX_WHITELIST = 25;

const row = (component: MessageActionRowComponentBuilder) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(component);

export const automodStep: SetupStep = {
  id: 'filters',
  async render(ctx) {
    const s = await ctx.bot.settings.module(ctx.guild.id, automodSettings);

    const filters = new StringSelectMenuBuilder()
      .setCustomId('automod:setup:filters')
      .setPlaceholder(ctx.t('automod.setup.filtersPlaceholder'))
      .setMinValues(0)
      .setMaxValues(FILTERS.length)
      .addOptions(
        FILTERS.map((name) =>
          new StringSelectMenuOptionBuilder()
            .setValue(name)
            .setLabel(ctx.t(`automod.filters.${name}`))
            .setDescription(ctx.t(`automod.filterHelp.${name}`).slice(0, 100))
            .setDefault(s.filters[name].enabled),
        ),
      );
    const roles = new RoleSelectMenuBuilder()
      .setCustomId('automod:setup:roles')
      .setPlaceholder(ctx.t('automod.setup.rolesPlaceholder'))
      .setMinValues(0)
      .setMaxValues(MAX_WHITELIST)
      .setDefaultRoles(s.whitelistRoles.slice(0, MAX_WHITELIST));
    const channels = new ChannelSelectMenuBuilder()
      .setCustomId('automod:setup:channels')
      .setPlaceholder(ctx.t('automod.setup.channelsPlaceholder'))
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice, ChannelType.GuildCategory)
      .setMinValues(0)
      .setMaxValues(MAX_WHITELIST)
      .setDefaultChannels(s.whitelistChannels.slice(0, MAX_WHITELIST));

    return {
      text: ctx.t('automod.setup.body', { command: ctx.bot.commandMention('automod configure') }),
      rows: [row(filters), row(roles), row(channels)],
    };
  },
};

export const automodSetupComponents = [
  defineComponent({
    kind: 'select',
    id: 'automod:setup:filters',
    permissions: MANAGE,
    async run(ctx) {
      const selected = new Set(ctx.interaction.values);
      const current = await ctx.bot.settings.module(ctx.guild.id, automodSettings);
      const filters = Object.fromEntries(FILTERS.map((name) => [name, { ...current.filters[name], enabled: selected.has(name) }]));
      await ctx.bot.settings.updateModule(ctx.guild.id, automodSettings, { filters: filters as typeof current.filters });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'select',
    id: 'automod:setup:roles',
    permissions: MANAGE,
    async run(ctx) {
      await ctx.bot.settings.updateModule(ctx.guild.id, automodSettings, { whitelistRoles: [...ctx.interaction.values] });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'select',
    id: 'automod:setup:channels',
    permissions: MANAGE,
    async run(ctx) {
      await ctx.bot.settings.updateModule(ctx.guild.id, automodSettings, { whitelistChannels: [...ctx.interaction.values] });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
];
