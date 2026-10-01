import { ChannelType, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, userMention } from 'discord.js';
import { defineCommand, defineModule } from '../../../core/module.js';
import { countingEvents } from './events.js';
import { countingState, resetCount } from './model.js';
import { countingConfig, countingSettings } from './settings.js';
import { countingSetupComponents, countingStep } from './setup.js';

const counting = defineCommand({
  data: new SlashCommandBuilder()
    .setName('counting')
    .setDescription('counting.command.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('settings')
        .setDescription('counting.command.settings')
        .addChannelOption((o) => o.setName('channel').setDescription('counting.command.options.channel').addChannelTypes(ChannelType.GuildText))
        .addBooleanOption((o) => o.setName('reset_on_fail').setDescription('counting.command.options.resetOnFail'))
        .addBooleanOption((o) => o.setName('allow_twice').setDescription('counting.command.options.allowTwice'))
        .addBooleanOption((o) => o.setName('allow_chat').setDescription('counting.command.options.allowChat')),
    )
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('counting.command.set')
        .addIntegerOption((o) => o.setName('number').setDescription('counting.command.options.number').setRequired(true).setMinValue(0)),
    )
    .addSubcommand((s) => s.setName('stats').setDescription('counting.command.stats')),
  defer: 'ephemeral',
  permissions: { user: PermissionFlagsBits.ManageGuild, allowStaff: true },
  async run(ctx) {
    const { options } = ctx.interaction;
    const sub = options.getSubcommand();
    const settings = await ctx.bot.settings.module(ctx.guild.id, countingSettings);

    if (sub === 'settings') {
      const s = await ctx.bot.settings.updateModule(ctx.guild.id, countingSettings, {
        channelId: options.getChannel('channel')?.id ?? settings.channelId,
        resetOnFail: options.getBoolean('reset_on_fail') ?? settings.resetOnFail,
        allowTwice: options.getBoolean('allow_twice') ?? settings.allowTwice,
        allowChat: options.getBoolean('allow_chat') ?? settings.allowChat,
      });
      const onOff = (v: boolean) => ctx.t(v ? 'common.on' : 'common.off');
      await ctx.respond(
        ctx.successPanel(
          ctx.t('counting.command.saved', {
            channel: s.channelId ? `<#${s.channelId}>` : ctx.t('common.none'),
            reset: onOff(s.resetOnFail),
            twice: onOff(s.allowTwice),
            chat: onOff(s.allowChat),
          }),
        ),
      );
      return;
    }

    if (sub === 'set') {
      const value = options.getInteger('number', true);
      await resetCount(ctx.guild.id, value);
      await ctx.respond(ctx.successPanel(ctx.t('counting.command.setDone', { next: value + 1 })));
      return;
    }

    const state = await countingState(ctx.guild.id);
    await ctx.respond(
      ctx
        .panel()
        .title(ctx.t('counting.stats.title'))
        .fields([
          { name: ctx.t('counting.stats.current'), value: String(state.current), inline: true },
          { name: ctx.t('counting.stats.record'), value: String(state.highScore), inline: true },
          { name: ctx.t('counting.stats.last'), value: state.lastUserId ? userMention(state.lastUserId) : ctx.t('common.none'), inline: true },
        ]),
    );
  },
});

export default defineModule({
  name: 'counting',
  toggleable: true,
  // MessageContent is privileged: it has to be switched on in the Developer Portal.
  intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  config: countingConfig,
  guildSettings: countingSettings.guildSettings,
  commands: [counting],
  components: countingSetupComponents,
  events: countingEvents,
  setup: [countingStep],
});
