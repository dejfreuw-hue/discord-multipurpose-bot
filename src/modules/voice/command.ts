import { ChannelType, channelMention, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { UserError } from '../../core/errors.js';
import { defineCommand } from '../../core/module.js';
import { postPanel, tempChannel } from './channels.js';
import { addHub, createHub } from './hubs.js';
import { voiceSettings } from './settings.js';

const MANAGE = PermissionFlagsBits.ManageGuild;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('voice.command.description')
    .addSubcommand((s) => s.setName('panel').setDescription('voice.command.panel'))
    .addSubcommandGroup((g) =>
      g
        .setName('hub')
        .setDescription('voice.command.hub')
        .addSubcommand((s) => s.setName('create').setDescription('voice.command.create'))
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('voice.command.add')
            .addChannelOption((o) => o.setName('channel').setDescription('voice.command.options.channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice))
            .addChannelOption((o) => o.setName('category').setDescription('voice.command.options.category').addChannelTypes(ChannelType.GuildCategory))
            .addStringOption((o) => o.setName('name').setDescription('voice.command.options.name').setMaxLength(100))
            .addIntegerOption((o) => o.setName('limit').setDescription('voice.command.options.limit').setMinValue(0).setMaxValue(99)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('voice.command.remove')
            .addChannelOption((o) => o.setName('channel').setDescription('voice.command.options.channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice)),
        )
        .addSubcommand((s) => s.setName('list').setDescription('voice.command.list')),
    ),
  defer: 'ephemeral',
  async run(ctx) {
    const { options } = ctx.interaction;
    if (!options.getSubcommandGroup()) {
      const channel = ctx.member.voice.channel;
      const doc = channel ? await tempChannel(channel.id) : null;
      if (!channel || channel.type !== ChannelType.GuildVoice || !doc) throw new UserError('voice.errors.notInTemp');
      if (doc.ownerId !== ctx.member.id && !ctx.member.permissions.has(PermissionFlagsBits.ManageChannels)) throw new UserError('voice.errors.ownerOnly');
      await postPanel(ctx.bot, channel);
      await ctx.respond(ctx.successPanel(ctx.t('voice.command.panelPosted', { channel: channel.toString() })));
      return;
    }

    if (!ctx.member.permissions.has(MANAGE) && !ctx.bot.isOwner(ctx.member.id)) {
      throw new UserError('errors.userPermissions', { permissions: 'Manage Server' });
    }
    const sub = options.getSubcommand();
    const settings = await ctx.bot.settings.module(ctx.guild.id, voiceSettings);

    if (sub === 'create') {
      const id = await createHub(ctx.bot, ctx.guild, { category: ctx.t('voice.defaults.category'), hub: ctx.t('voice.defaults.hub') });
      await ctx.respond(ctx.successPanel(ctx.t('voice.command.created', { channel: channelMention(id) })));
    } else if (sub === 'add') {
      const channel = options.getChannel('channel', true);
      await addHub(ctx.bot, ctx.guild, {
        channelId: channel.id,
        categoryId: options.getChannel('category')?.id ?? null,
        nameTemplate: options.getString('name') ?? undefined,
        userLimit: options.getInteger('limit') ?? undefined,
      });
      await ctx.respond(ctx.successPanel(ctx.t('voice.command.added', { channel: channel.toString() })));
    } else if (sub === 'remove') {
      const channel = options.getChannel('channel', true);
      if (!settings.hubs.some((h) => h.channelId === channel.id)) throw new UserError('voice.errors.notHub');
      await ctx.bot.settings.updateModule(ctx.guild.id, voiceSettings, { hubs: settings.hubs.filter((h) => h.channelId !== channel.id) });
      await ctx.respond(ctx.successPanel(ctx.t('voice.command.removed', { channel: channel.toString() })));
    } else {
      const lines = settings.hubs.map((h) =>
        ctx.t('voice.command.hubLine', {
          channel: channelMention(h.channelId),
          name: h.nameTemplate,
          limit: h.userLimit || ctx.t('voice.panel.noLimit'),
        }),
      );
      await ctx.respond(ctx.panel().title(ctx.t('voice.command.listTitle')).text(lines.join('\n') || ctx.t('voice.command.none')));
    }
  },
});
