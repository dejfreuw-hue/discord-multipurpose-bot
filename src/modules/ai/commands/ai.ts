import {
  ChannelType,
  channelMention,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { CommandContext, InteractionContext } from '../../../core/context.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand, defineComponent } from '../../../core/module.js';
import { availableProviders, providerFor } from '../engine.js';
import { PERSONALITIES } from '../personalities.js';
import { PROVIDERS, type ProviderName } from '../providers/types.js';
import { aiConfig, aiSettings, type AiSettings } from '../settings.js';
import { usage } from '../usage.js';

const MAX_CHANNELS = 25;
const MAX_BLACKLIST = 100;
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.PublicThread] as const;

async function statusPanel(ctx: InteractionContext, settings: AiSettings) {
  const { bot } = ctx;
  const available = [...availableProviders(bot).keys()];
  const none = ctx.t('common.none');
  let provider: string;
  try {
    const chosen = providerFor(bot, settings);
    provider = `${ctx.t(`ai.providers.${chosen.provider.name}`)} (\`${chosen.chatModel}\`)`;
  } catch {
    provider = ctx.t('ai.status.noProvider');
  }
  const used = await usage(ctx.guild!.id);
  const cap = Math.min(settings.dailyTokens, bot.moduleConfig({ name: 'ai', config: aiConfig }).maxDailyTokens);
  const scanner = settings.scanner;
  const level = (n: number) => (n > 0 ? `${n}%` : ctx.t('common.off'));
  const mention = (id: string) => (ctx.guild!.roles.cache.has(id) ? `<@&${id}>` : `<@${id}>`);

  return ctx
    .panel()
    .title(ctx.t('ai.status.title'))
    .fields([
      { name: ctx.t('ai.status.provider'), value: provider, inline: true },
      { name: ctx.t('ai.status.available'), value: available.map((p) => ctx.t(`ai.providers.${p}`)).join(', ') || none, inline: true },
      { name: ctx.t('ai.status.personality'), value: ctx.t(`ai.personalities.${settings.personality}`), inline: true },
      { name: ctx.t('ai.status.channels'), value: settings.channels.map(channelMention).join(', ') || none },
      { name: ctx.t('ai.status.mentions'), value: ctx.t(settings.replyToMentions ? 'common.on' : 'common.off'), inline: true },
      { name: ctx.t('ai.status.limits'), value: ctx.t('ai.status.limitsValue', { perMinute: settings.userPerMinute, history: settings.history }), inline: true },
      { name: ctx.t('ai.status.usage'), value: ctx.t('ai.status.usageValue', { used: used.tokens.toLocaleString(), cap: cap.toLocaleString(), requests: used.requests }) },
      { name: ctx.t('ai.status.blacklist'), value: settings.blacklist.map(mention).join(', ') || none },
      {
        name: ctx.t('ai.status.scanner'),
        value: [
          ctx.t(scanner.enabled ? 'common.on' : 'common.off'),
          ctx.t('ai.status.thresholds', { alert: level(scanner.alert), delete: level(scanner.delete), timeout: level(scanner.timeout) }),
          scanner.channels.length > 0 ? scanner.channels.map(channelMention).join(', ') : ctx.t('ai.status.allChannels'),
        ].join('\n'),
      },
    ]);
}

async function save(ctx: CommandContext<true>, patch: Partial<AiSettings>): Promise<AiSettings> {
  return ctx.bot.settings.updateModule(ctx.guild.id, aiSettings, patch);
}

function toggleId(list: readonly string[], id: string, add: boolean, max: number): string[] {
  if (!add) return list.filter((x) => x !== id);
  if (list.includes(id)) return [...list];
  if (list.length >= max) throw new UserError('ai.errors.listFull', { max });
  return [...list, id];
}

export const personaSubmit = defineComponent({
  kind: 'modal',
  id: 'ai:persona',
  defer: 'ephemeral',
  permissions: { user: PermissionFlagsBits.ManageGuild },
  async run(ctx) {
    const prompt = ctx.interaction.fields.getTextInputValue('prompt').trim();
    await ctx.bot.settings.updateModule(ctx.guild.id, aiSettings, { customPrompt: prompt || null, personality: prompt ? 'custom' : 'helpful' });
    await ctx.respond(ctx.successPanel(ctx.t(prompt ? 'ai.persona.saved' : 'ai.persona.cleared')));
  },
});

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('ai')
    .setDescription('ai.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('status').setDescription('ai.status.description'))
    .addSubcommand((s) =>
      s
        .setName('provider')
        .setDescription('ai.provider.description')
        .addStringOption((o) =>
          o
            .setName('name')
            .setDescription('ai.provider.options.name')
            .setRequired(true)
            .addChoices(...PROVIDERS.map((p) => ({ name: `ai.providers.${p}`, value: p }))),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('personality')
        .setDescription('ai.personality.description')
        .addStringOption((o) =>
          o
            .setName('preset')
            .setDescription('ai.personality.options.preset')
            .setRequired(true)
            .addChoices(...[...Object.keys(PERSONALITIES), 'custom'].map((p) => ({ name: `ai.personalities.${p}`, value: p }))),
        ),
    )
    .addSubcommand((s) => s.setName('persona').setDescription('ai.persona.description'))
    .addSubcommand((s) =>
      s
        .setName('limits')
        .setDescription('ai.limits.description')
        .addIntegerOption((o) => o.setName('daily_tokens').setDescription('ai.limits.options.dailyTokens').setMinValue(0).setMaxValue(100_000_000))
        .addIntegerOption((o) => o.setName('per_minute').setDescription('ai.limits.options.perMinute').setMinValue(1).setMaxValue(30))
        .addIntegerOption((o) => o.setName('history').setDescription('ai.limits.options.history').setMinValue(0).setMaxValue(30)),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('channels')
        .setDescription('ai.channels.description')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('ai.channels.add')
            .addChannelOption((o) => o.setName('channel').setDescription('ai.channels.options.channel').setRequired(true).addChannelTypes(...TEXT_CHANNELS)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('ai.channels.remove')
            .addChannelOption((o) => o.setName('channel').setDescription('ai.channels.options.channel').setRequired(true).addChannelTypes(...TEXT_CHANNELS)),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('blacklist')
        .setDescription('ai.blacklist.description')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('ai.blacklist.add')
            .addMentionableOption((o) => o.setName('target').setDescription('ai.blacklist.options.target').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('ai.blacklist.remove')
            .addMentionableOption((o) => o.setName('target').setDescription('ai.blacklist.options.target').setRequired(true)),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('scanner')
        .setDescription('ai.scanner.description')
        .addSubcommand((s) =>
          s
            .setName('settings')
            .setDescription('ai.scanner.settings')
            .addBooleanOption((o) => o.setName('enabled').setDescription('ai.scanner.options.enabled'))
            .addIntegerOption((o) => o.setName('alert').setDescription('ai.scanner.options.alert').setMinValue(0).setMaxValue(100))
            .addIntegerOption((o) => o.setName('delete').setDescription('ai.scanner.options.delete').setMinValue(0).setMaxValue(100))
            .addIntegerOption((o) => o.setName('timeout').setDescription('ai.scanner.options.timeout').setMinValue(0).setMaxValue(100))
            .addIntegerOption((o) => o.setName('timeout_minutes').setDescription('ai.scanner.options.timeoutMinutes').setMinValue(1).setMaxValue(40_320)),
        )
        .addSubcommand((s) =>
          s
            .setName('add-channel')
            .setDescription('ai.scanner.addChannel')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('ai.scanner.options.channel').setRequired(true).addChannelTypes(...TEXT_CHANNELS, ChannelType.GuildCategory),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove-channel')
            .setDescription('ai.scanner.removeChannel')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('ai.scanner.options.channel').setRequired(true).addChannelTypes(...TEXT_CHANNELS, ChannelType.GuildCategory),
            ),
        ),
    ),
  // The persona subcommand opens a modal, which can't follow a deferred reply.
  defer: false,
  permissions: { user: PermissionFlagsBits.ManageGuild },
  async run(ctx) {
    const { options } = ctx.interaction;
    const group = options.getSubcommandGroup();
    const sub = options.getSubcommand();
    const settings = await ctx.bot.settings.module(ctx.guild.id, aiSettings);

    if (!group && sub === 'persona') {
      const input = new TextInputBuilder()
        .setCustomId('prompt')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1500)
        .setRequired(false)
        .setPlaceholder(ctx.t('ai.persona.placeholder'));
      if (settings.customPrompt) input.setValue(settings.customPrompt);
      await ctx.interaction.showModal(
        new ModalBuilder()
          .setCustomId('ai:persona')
          .setTitle(ctx.t('ai.persona.title'))
          .addLabelComponents(new LabelBuilder().setLabel(ctx.t('ai.persona.label')).setTextInputComponent(input)),
      );
      return;
    }
    await ctx.interaction.deferReply({ flags: MessageFlags.Ephemeral });
    ctx.deferMode = 'ephemeral';

    if (!group) {
      switch (sub) {
        case 'status':
          return ctx.respond(await statusPanel(ctx, settings));
        case 'provider': {
          const name = options.getString('name', true) as ProviderName;
          if (!availableProviders(ctx.bot).has(name)) throw new UserError('ai.provider.unavailable', { provider: ctx.t(`ai.providers.${name}`) });
          await save(ctx, { provider: name });
          return ctx.respond(ctx.successPanel(ctx.t('ai.provider.done', { provider: ctx.t(`ai.providers.${name}`) })));
        }
        case 'personality': {
          const preset = options.getString('preset', true);
          if (preset === 'custom' && !settings.customPrompt) throw new UserError('ai.personality.noCustom', { command: ctx.bot.commandMention('ai persona') });
          await save(ctx, { personality: preset });
          return ctx.respond(ctx.successPanel(ctx.t('ai.personality.done', { personality: ctx.t(`ai.personalities.${preset}`) })));
        }
        case 'limits': {
          const patch: Partial<AiSettings> = {};
          const daily = options.getInteger('daily_tokens');
          const perMinute = options.getInteger('per_minute');
          const historySize = options.getInteger('history');
          if (daily !== null) patch.dailyTokens = daily;
          if (perMinute !== null) patch.userPerMinute = perMinute;
          if (historySize !== null) patch.history = historySize;
          const updated = await save(ctx, patch);
          const cap = ctx.bot.moduleConfig({ name: 'ai', config: aiConfig }).maxDailyTokens;
          const capped = updated.dailyTokens > cap ? `\n-# ${ctx.t('ai.limits.capped', { cap: cap.toLocaleString() })}` : '';
          return ctx.respond(
            ctx.successPanel(
              ctx.t('ai.limits.done', { daily: updated.dailyTokens.toLocaleString(), perMinute: updated.userPerMinute, history: updated.history }) + capped,
            ),
          );
        }
      }
    }

    if (group === 'channels') {
      const channel = options.getChannel('channel', true);
      await save(ctx, { channels: toggleId(settings.channels, channel.id, sub === 'add', MAX_CHANNELS) });
      return ctx.respond(ctx.successPanel(ctx.t(sub === 'add' ? 'ai.channels.added' : 'ai.channels.removed', { channel: channelMention(channel.id) })));
    }

    if (group === 'blacklist') {
      const target = options.getMentionable('target', true);
      const id = 'id' in target ? target.id : '';
      await save(ctx, { blacklist: toggleId(settings.blacklist, id, sub === 'add', MAX_BLACKLIST) });
      return ctx.respond(ctx.successPanel(ctx.t(sub === 'add' ? 'ai.blacklist.added' : 'ai.blacklist.removed', { target: String(target) })));
    }

    if (group === 'scanner') {
      if (sub === 'settings') {
        const scanner = { ...settings.scanner };
        const enabled = options.getBoolean('enabled');
        if (enabled !== null) scanner.enabled = enabled;
        for (const key of ['alert', 'delete', 'timeout'] as const) {
          const value = options.getInteger(key);
          if (value !== null) scanner[key] = value;
        }
        const minutes = options.getInteger('timeout_minutes');
        if (minutes !== null) scanner.timeoutMinutes = minutes;
        if (scanner.enabled && !providerFor(ctx.bot, settings).visionModel) throw new UserError('ai.errors.noVisionModel');
        const updated = await save(ctx, { scanner });
        return ctx.respond(await statusPanel(ctx, updated));
      }
      const channel = options.getChannel('channel', true);
      const channels = toggleId(settings.scanner.channels, channel.id, sub === 'add-channel', MAX_CHANNELS);
      await save(ctx, { scanner: { ...settings.scanner, channels } });
      return ctx.respond(
        ctx.successPanel(ctx.t(sub === 'add-channel' ? 'ai.scanner.channelAdded' : 'ai.scanner.channelRemoved', { channel: channelMention(channel.id) })),
      );
    }
  },
});
