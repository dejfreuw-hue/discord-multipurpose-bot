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
import { starboardSettings } from './settings.js';

const STEP = 'starboard.channel';
const MANAGE = { user: PermissionFlagsBits.ManageGuild };
const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(c);

export const starboardStep: SetupStep = {
  id: 'channel',
  async render(ctx) {
    const s = await ctx.bot.settings.module(ctx.guild.id, starboardSettings);
    const menu = new ChannelSelectMenuBuilder()
      .setCustomId('starboard:setup:channel')
      .setPlaceholder(ctx.t('starboard.setup.placeholder'))
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(1);
    if (s.channelId) menu.setDefaultChannels(s.channelId);
    const button = (id: string, label: string, style = ButtonStyle.Secondary) =>
      new ButtonBuilder().setCustomId(`starboard:setup:${id}`).setStyle(style).setLabel(label);
    return {
      text: ctx.t('starboard.setup.body', { command: ctx.bot.commandMention('starboard settings'), emoji: s.emoji, threshold: s.threshold }),
      rows: [
        row(menu),
        row(
          button('threshold:-1', '-1').setDisabled(s.threshold <= 1),
          button('threshold:1', '+1').setDisabled(s.threshold >= 100),
          button('self', `${ctx.t('starboard.setup.selfStar')}: ${ctx.t(s.selfStar ? 'common.on' : 'common.off')}`, s.selfStar ? ButtonStyle.Success : ButtonStyle.Secondary),
        ),
      ],
    };
  },
};

export const starboardSetupComponents = [
  defineComponent({
    kind: 'select',
    id: 'starboard:setup:channel',
    permissions: MANAGE,
    async run(ctx) {
      await ctx.bot.settings.updateModule(ctx.guild.id, starboardSettings, { channelId: ctx.interaction.values[0] ?? null });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'button',
    id: 'starboard:setup:threshold',
    permissions: MANAGE,
    async run(ctx, [step]) {
      const s = await ctx.bot.settings.module(ctx.guild.id, starboardSettings);
      const threshold = Math.min(100, Math.max(1, s.threshold + Number(step)));
      if (!Number.isFinite(threshold)) throw new UserError('errors.expired');
      await ctx.bot.settings.updateModule(ctx.guild.id, starboardSettings, { threshold });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'button',
    id: 'starboard:setup:self',
    permissions: MANAGE,
    async run(ctx) {
      const s = await ctx.bot.settings.module(ctx.guild.id, starboardSettings);
      await ctx.bot.settings.updateModule(ctx.guild.id, starboardSettings, { selfStar: !s.selfStar });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
];
