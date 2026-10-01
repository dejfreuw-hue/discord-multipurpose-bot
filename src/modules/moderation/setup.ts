import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  channelMention,
  PermissionFlagsBits,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { UserError } from '../../core/errors.js';
import { defineComponent, type SetupStep } from '../../core/module.js';
import { renderWizard } from '../core/setup/wizard.js';
import { moderationSettings, type ModerationSettings } from './settings.js';

const TOGGLES = ['dmUsers', 'requireReason', 'logExternal'] as const;
type Toggle = (typeof TOGGLES)[number];

const MANAGE = { user: PermissionFlagsBits.ManageGuild };
const STEP = 'moderation.logging';

export const moderationStep: SetupStep = {
  id: 'logging',
  async render(ctx) {
    const s = await ctx.bot.settings.module(ctx.guild.id, moderationSettings);
    const channel = new ChannelSelectMenuBuilder()
      .setCustomId('moderation:setup:log')
      .setPlaceholder(ctx.t('moderation.setup.logPlaceholder'))
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(0)
      .setMaxValues(1);
    if (s.logChannelId) channel.setDefaultChannels(s.logChannelId);

    const toggles = TOGGLES.map((key) =>
      new ButtonBuilder()
        .setCustomId(`moderation:setup:toggle:${key}`)
        .setStyle(s[key] ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setLabel(`${ctx.t(`moderation.setup.${key}`)}: ${ctx.t(s[key] ? 'common.on' : 'common.off')}`),
    );

    return {
      text: ctx.t('moderation.setup.body', {
        channel: s.logChannelId ? channelMention(s.logChannelId) : ctx.t('moderation.setup.noChannel'),
      }),
      rows: [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(channel),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(toggles),
      ],
    };
  },
};

export const moderationSetupComponents = [
  defineComponent({
    kind: 'select',
    id: 'moderation:setup:log',
    permissions: MANAGE,
    async run(ctx) {
      await ctx.bot.settings.updateModule(ctx.guild.id, moderationSettings, { logChannelId: ctx.interaction.values[0] ?? null });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'button',
    id: 'moderation:setup:toggle',
    permissions: MANAGE,
    async run(ctx, [key]) {
      if (!TOGGLES.includes(key as Toggle)) throw new UserError('errors.expired');
      const current: ModerationSettings = await ctx.bot.settings.module(ctx.guild.id, moderationSettings);
      await ctx.bot.settings.updateModule(ctx.guild.id, moderationSettings, { [key as Toggle]: !current[key as Toggle] });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
];
