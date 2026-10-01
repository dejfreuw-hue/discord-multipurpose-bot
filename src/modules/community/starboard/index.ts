import { ChannelType, GatewayIntentBits, Partials, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { looksLikeEmoji } from '../../../core/emoji.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand, defineModule } from '../../../core/module.js';
import { starboardEvents } from './events.js';
import { starboardSettings } from './settings.js';
import { starboardSetupComponents, starboardStep } from './setup.js';

const starboard = defineCommand({
  data: new SlashCommandBuilder()
    .setName('starboard')
    .setDescription('starboard.command.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('settings')
        .setDescription('starboard.command.settings')
        .addChannelOption((o) => o.setName('channel').setDescription('starboard.command.options.channel').addChannelTypes(ChannelType.GuildText))
        .addStringOption((o) => o.setName('emoji').setDescription('starboard.command.options.emoji').setMaxLength(64))
        .addIntegerOption((o) => o.setName('threshold').setDescription('starboard.command.options.threshold').setMinValue(1).setMaxValue(100))
        .addBooleanOption((o) => o.setName('self_star').setDescription('starboard.command.options.selfStar')),
    )
    .addSubcommand((s) =>
      s
        .setName('ignore')
        .setDescription('starboard.command.ignore')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('starboard.command.options.ignored')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice),
        ),
    ),
  defer: 'ephemeral',
  permissions: { user: PermissionFlagsBits.ManageGuild, allowStaff: true },
  async run(ctx) {
    const { options } = ctx.interaction;
    const current = await ctx.bot.settings.module(ctx.guild.id, starboardSettings);

    if (options.getSubcommand() === 'ignore') {
      const id = options.getChannel('channel', true).id;
      const ignored = current.ignoredChannelIds.includes(id);
      await ctx.bot.settings.updateModule(ctx.guild.id, starboardSettings, {
        ignoredChannelIds: ignored ? current.ignoredChannelIds.filter((c) => c !== id) : [...current.ignoredChannelIds, id],
      });
      await ctx.respond(ctx.successPanel(ctx.t(ignored ? 'starboard.command.unignored' : 'starboard.command.ignored', { channel: `<#${id}>` })));
      return;
    }

    const emoji = options.getString('emoji')?.trim();
    if (emoji && !looksLikeEmoji(emoji)) throw new UserError('starboard.errors.emoji');
    const s = await ctx.bot.settings.updateModule(ctx.guild.id, starboardSettings, {
      channelId: options.getChannel('channel')?.id ?? current.channelId,
      emoji: emoji ?? current.emoji,
      threshold: options.getInteger('threshold') ?? current.threshold,
      selfStar: options.getBoolean('self_star') ?? current.selfStar,
    });
    await ctx.respond(
      ctx.successPanel(
        ctx.t('starboard.command.saved', {
          channel: s.channelId ? `<#${s.channelId}>` : ctx.t('common.none'),
          emoji: s.emoji,
          threshold: s.threshold,
          self: ctx.t(s.selfStar ? 'common.on' : 'common.off'),
        }),
      ),
    );
  },
});

export default defineModule({
  name: 'starboard',
  toggleable: true,
  // MessageContent is privileged: it has to be switched on in the Developer Portal. Reactions on
  // messages sent before the bot started only arrive with the Message, Reaction and User partials.
  intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
  guildSettings: starboardSettings.guildSettings,
  commands: [starboard],
  components: starboardSetupComponents,
  events: starboardEvents,
  setup: [starboardStep],
});
