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
import { countingSettings } from './settings.js';

const STEP = 'counting.channel';
const MANAGE = { user: PermissionFlagsBits.ManageGuild };
const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(c);

export const countingStep: SetupStep = {
  id: 'channel',
  async render(ctx) {
    const s = await ctx.bot.settings.module(ctx.guild.id, countingSettings);
    const menu = new ChannelSelectMenuBuilder()
      .setCustomId('counting:setup:channel')
      .setPlaceholder(ctx.t('counting.setup.placeholder'))
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(1);
    if (s.channelId) menu.setDefaultChannels(s.channelId);
    const toggle = (key: 'resetOnFail' | 'allowTwice') =>
      new ButtonBuilder()
        .setCustomId(`counting:setup:toggle:${key}`)
        .setStyle(s[key] ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setLabel(`${ctx.t(`counting.setup.${key}`)}: ${ctx.t(s[key] ? 'common.on' : 'common.off')}`);
    return {
      text: ctx.t('counting.setup.body', { command: ctx.bot.commandMention('counting settings') }),
      rows: [row(menu), row(toggle('resetOnFail'), toggle('allowTwice'))],
    };
  },
};

export const countingSetupComponents = [
  defineComponent({
    kind: 'select',
    id: 'counting:setup:channel',
    permissions: MANAGE,
    async run(ctx) {
      await ctx.bot.settings.updateModule(ctx.guild.id, countingSettings, { channelId: ctx.interaction.values[0] ?? null });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'button',
    id: 'counting:setup:toggle',
    permissions: MANAGE,
    async run(ctx, [key]) {
      if (key !== 'resetOnFail' && key !== 'allowTwice') throw new UserError('errors.expired');
      const s = await ctx.bot.settings.module(ctx.guild.id, countingSettings);
      await ctx.bot.settings.updateModule(ctx.guild.id, countingSettings, { [key]: !s[key] });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
];
