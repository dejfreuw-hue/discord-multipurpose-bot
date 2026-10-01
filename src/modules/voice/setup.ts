import { ActionRowBuilder, ButtonBuilder, ButtonStyle, channelMention, PermissionFlagsBits, type MessageActionRowComponentBuilder } from 'discord.js';
import { defineComponent, type SetupStep } from '../../core/module.js';
import { renderWizard } from '../core/setup/wizard.js';
import { createHub, MAX_HUBS } from './hubs.js';
import { voiceSettings } from './settings.js';

const STEP = 'voice.hubs';

export const voiceStep: SetupStep = {
  id: 'hubs',
  async render(ctx) {
    const { hubs } = await ctx.bot.settings.module(ctx.guild.id, voiceSettings);
    const list = hubs.map((h) => `- ${channelMention(h.channelId)}`).join('\n') || ctx.t('voice.command.none');
    const create = new ButtonBuilder()
      .setCustomId('voice:setup:create')
      .setStyle(ButtonStyle.Primary)
      .setLabel(ctx.t('voice.setup.create'))
      .setDisabled(hubs.length >= MAX_HUBS);
    return {
      text: `${ctx.t('voice.setup.body', { command: ctx.bot.commandMention('voice hub add') })}\n\n${list}`,
      rows: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(create)],
    };
  },
};

export const voiceSetupComponents = [
  defineComponent({
    kind: 'button',
    id: 'voice:setup:create',
    permissions: { user: PermissionFlagsBits.ManageGuild },
    async run(ctx) {
      await createHub(ctx.bot, ctx.guild, { category: ctx.t('voice.defaults.category'), hub: ctx.t('voice.defaults.hub') });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
];
