import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { defineComponent, type SetupStep } from '../../../core/module.js';
import { renderWizard } from '../../core/setup/wizard.js';
import { suggestionSettings } from './settings.js';

const STEP = 'suggestions.channel';
const MANAGE = { user: PermissionFlagsBits.ManageGuild };
const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(c);

export const suggestionStep: SetupStep = {
  id: 'channel',
  async render(ctx) {
    const s = await ctx.bot.settings.module(ctx.guild.id, suggestionSettings);
    const menu = new ChannelSelectMenuBuilder()
      .setCustomId('suggestions:setup:channel')
      .setPlaceholder(ctx.t('suggestions.setup.placeholder'))
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(1);
    if (s.channelId) menu.setDefaultChannels(s.channelId);
    const toggle = (key: 'threads' | 'dmAuthor') =>
      new ButtonBuilder()
        .setCustomId(`suggestions:setup:toggle:${key}`)
        .setStyle(s[key] ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setLabel(`${ctx.t(`suggestions.setup.${key}`)}: ${ctx.t(s[key] ? 'common.on' : 'common.off')}`);
    return {
      text: ctx.t('suggestions.setup.body', { command: ctx.bot.commandMention('suggest') }),
      rows: [row(menu), row(toggle('threads'), toggle('dmAuthor'))],
    };
  },
};

export const suggestionSetupComponents = [
  defineComponent({
    kind: 'select',
    id: 'suggestions:setup:channel',
    permissions: MANAGE,
    async run(ctx) {
      await ctx.bot.settings.updateModule(ctx.guild.id, suggestionSettings, { channelId: ctx.interaction.values[0] ?? null });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'button',
    id: 'suggestions:setup:toggle',
    permissions: MANAGE,
    async run(ctx, [key]) {
      if (key !== 'threads' && key !== 'dmAuthor') throw new UserError('errors.expired');
      const s = await ctx.bot.settings.module(ctx.guild.id, suggestionSettings);
      await ctx.bot.settings.updateModule(ctx.guild.id, suggestionSettings, { [key]: !s[key] });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
];
