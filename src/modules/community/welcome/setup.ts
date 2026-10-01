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
import { welcomeSettings } from './settings.js';

const STEP = 'welcome.messages';
const MANAGE = { user: PermissionFlagsBits.ManageGuild };
const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(c);

export const welcomeStep: SetupStep = {
  id: 'messages',
  async render(ctx) {
    const s = await ctx.bot.settings.module(ctx.guild.id, welcomeSettings);
    const channel = (kind: 'join' | 'leave') => {
      const menu = new ChannelSelectMenuBuilder()
        .setCustomId(`welcome:setup:channel:${kind}`)
        .setPlaceholder(ctx.t(`welcome.setup.${kind}Placeholder`))
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1);
      if (s[kind].channelId) menu.setDefaultChannels(s[kind].channelId!);
      return menu;
    };
    const toggle = (kind: 'join' | 'leave') =>
      new ButtonBuilder()
        .setCustomId(`welcome:setup:toggle:${kind}`)
        .setStyle(s[kind].enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setLabel(`${ctx.t(`welcome.command.${kind}Title`)}: ${ctx.t(s[kind].enabled ? 'common.on' : 'common.off')}`);
    return {
      text: ctx.t('welcome.setup.body', { command: ctx.bot.commandMention('welcome test') }),
      rows: [row(channel('join')), row(channel('leave')), row(toggle('join'), toggle('leave'))],
    };
  },
};

export const welcomeSetupComponents = [
  defineComponent({
    kind: 'select',
    id: 'welcome:setup:channel',
    permissions: MANAGE,
    async run(ctx, [kind]) {
      if (kind !== 'join' && kind !== 'leave') throw new UserError('errors.expired');
      const s = await ctx.bot.settings.module(ctx.guild.id, welcomeSettings);
      const channelId = ctx.interaction.values[0] ?? null;
      // Picking a channel is a clear sign they want the message; clearing it turns it off.
      await ctx.bot.settings.updateModule(ctx.guild.id, welcomeSettings, { [kind]: { ...s[kind], channelId, enabled: Boolean(channelId) } });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'button',
    id: 'welcome:setup:toggle',
    permissions: MANAGE,
    async run(ctx, [kind]) {
      if (kind !== 'join' && kind !== 'leave') throw new UserError('errors.expired');
      const s = await ctx.bot.settings.module(ctx.guild.id, welcomeSettings);
      if (!s[kind].enabled && !s[kind].channelId) throw new UserError('welcome.errors.needChannel');
      await ctx.bot.settings.updateModule(ctx.guild.id, welcomeSettings, { [kind]: { ...s[kind], enabled: !s[kind].enabled } });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
];
