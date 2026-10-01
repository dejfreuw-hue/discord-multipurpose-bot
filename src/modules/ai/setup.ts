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
import { availableProviders, providerFor } from './engine.js';
import type { ProviderName } from './providers/types.js';
import { aiSettings } from './settings.js';

const MANAGE = { user: PermissionFlagsBits.ManageGuild };
const STEP = 'ai.chat';

const row = (...components: MessageActionRowComponentBuilder[]) =>
  new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(components);

export const aiStep: SetupStep = {
  id: 'chat',
  async render(ctx) {
    const s = await ctx.bot.settings.module(ctx.guild.id, aiSettings);
    const available = [...availableProviders(ctx.bot).keys()];
    if (available.length === 0) return { text: ctx.t('ai.setup.noProviders'), rows: [] };

    const current = providerFor(ctx.bot, s).provider.name;
    const provider = new StringSelectMenuBuilder()
      .setCustomId('ai:setup:provider')
      .addOptions(
        available.map((name) =>
          new StringSelectMenuOptionBuilder().setValue(name).setLabel(ctx.t(`ai.providers.${name}`)).setDefault(name === current),
        ),
      );
    const channels = new ChannelSelectMenuBuilder()
      .setCustomId('ai:setup:channels')
      .setPlaceholder(ctx.t('ai.setup.channelsPlaceholder'))
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(0)
      .setMaxValues(25)
      .setDefaultChannels(s.channels.slice(0, 25));
    const toggle = (key: 'mentions' | 'scanner', on: boolean) =>
      new ButtonBuilder()
        .setCustomId(`ai:setup:toggle:${key}`)
        .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setLabel(`${ctx.t(`ai.setup.${key}`)}: ${ctx.t(on ? 'common.on' : 'common.off')}`);

    return {
      text: ctx.t('ai.setup.body', { command: ctx.bot.commandMention('ai status') }),
      rows: [row(provider), row(channels), row(toggle('mentions', s.replyToMentions), toggle('scanner', s.scanner.enabled))],
    };
  },
};

export const aiSetupComponents = [
  defineComponent({
    kind: 'select',
    id: 'ai:setup:provider',
    permissions: MANAGE,
    async run(ctx) {
      const name = ctx.interaction.values[0] as ProviderName | undefined;
      if (!name || !availableProviders(ctx.bot).has(name)) throw new UserError('errors.expired');
      await ctx.bot.settings.updateModule(ctx.guild.id, aiSettings, { provider: name });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'select',
    id: 'ai:setup:channels',
    permissions: MANAGE,
    async run(ctx) {
      await ctx.bot.settings.updateModule(ctx.guild.id, aiSettings, { channels: [...ctx.interaction.values] });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'button',
    id: 'ai:setup:toggle',
    permissions: MANAGE,
    async run(ctx, [key]) {
      const s = await ctx.bot.settings.module(ctx.guild.id, aiSettings);
      if (key === 'mentions') {
        await ctx.bot.settings.updateModule(ctx.guild.id, aiSettings, { replyToMentions: !s.replyToMentions });
      } else if (key === 'scanner') {
        if (!s.scanner.enabled && !providerFor(ctx.bot, s).visionModel) throw new UserError('ai.errors.noVisionModel');
        await ctx.bot.settings.updateModule(ctx.guild.id, aiSettings, { scanner: { ...s.scanner, enabled: !s.scanner.enabled } });
      }
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
];
