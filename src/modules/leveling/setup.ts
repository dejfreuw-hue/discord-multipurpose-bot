import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { UserError } from '../../core/errors.js';
import { defineComponent, type SetupStep } from '../../core/module.js';
import { renderWizard } from '../core/setup/wizard.js';
import { levelingSettings, type LevelingSettings } from './settings.js';

const MANAGE = { user: PermissionFlagsBits.ManageGuild };
const STEP = 'leveling.xp';
const MODES = ['channel', 'dm', 'fixed', 'off'] as const;

const row = (...components: MessageActionRowComponentBuilder[]) =>
  new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(components);

export const levelingStep: SetupStep = {
  id: 'xp',
  async render(ctx) {
    const s = await ctx.bot.settings.module(ctx.guild.id, levelingSettings);
    const toggle = (key: 'text' | 'voice', on: boolean) =>
      new ButtonBuilder()
        .setCustomId(`leveling:setup:toggle:${key}`)
        .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setLabel(`${ctx.t(`leveling.setup.${key}`)}: ${ctx.t(on ? 'common.on' : 'common.off')}`);
    const mode = new StringSelectMenuBuilder()
      .setCustomId('leveling:setup:mode')
      .addOptions(
        MODES.map((m) =>
          new StringSelectMenuOptionBuilder().setValue(m).setLabel(ctx.t(`leveling.announce.modes.${m}`)).setDefault(s.announce.mode === m),
        ),
      );
    const rows = [row(toggle('text', s.text.enabled), toggle('voice', s.voice.enabled)), row(mode)];
    if (s.announce.mode === 'fixed') {
      const channel = new ChannelSelectMenuBuilder()
        .setCustomId('leveling:setup:channel')
        .setPlaceholder(ctx.t('leveling.setup.channelPlaceholder'))
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
      if (s.announce.channelId) channel.setDefaultChannels(s.announce.channelId);
      rows.push(row(channel));
    }
    return { text: ctx.t('leveling.setup.body', { command: ctx.bot.commandMention('levels status') }), rows };
  },
};

export const levelingSetupComponents = [
  defineComponent({
    kind: 'button',
    id: 'leveling:setup:toggle',
    permissions: MANAGE,
    async run(ctx, [key]) {
      if (key !== 'text' && key !== 'voice') throw new UserError('errors.expired');
      const s = await ctx.bot.settings.module(ctx.guild.id, levelingSettings);
      await ctx.bot.settings.updateModule(ctx.guild.id, levelingSettings, { [key]: { ...s[key], enabled: !s[key].enabled } });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'select',
    id: 'leveling:setup:mode',
    permissions: MANAGE,
    async run(ctx) {
      const mode = ctx.interaction.values[0] as LevelingSettings['announce']['mode'];
      if (!MODES.includes(mode)) throw new UserError('errors.expired');
      const s = await ctx.bot.settings.module(ctx.guild.id, levelingSettings);
      await ctx.bot.settings.updateModule(ctx.guild.id, levelingSettings, { announce: { ...s.announce, mode } });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'select',
    id: 'leveling:setup:channel',
    permissions: MANAGE,
    async run(ctx) {
      const s = await ctx.bot.settings.module(ctx.guild.id, levelingSettings);
      await ctx.bot.settings.updateModule(ctx.guild.id, levelingSettings, { announce: { ...s.announce, channelId: ctx.interaction.values[0] ?? null } });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
];
