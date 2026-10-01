import { ChannelType, Events, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand, defineEvent, defineModule } from '../../../core/module.js';
import { COUNTER_KINDS, countFor, counterName, needsMemberList, type CounterKind } from './counters.js';
import { refreshStats, startStatsTicker } from './refresh.js';
import { serverStatsSettings } from './settings.js';

const serverstats = defineCommand({
  data: new SlashCommandBuilder()
    .setName('serverstats')
    .setDescription('serverstats.command.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('serverstats.command.add')
        .addStringOption((o) =>
          o
            .setName('counter')
            .setDescription('serverstats.command.options.counter')
            .setRequired(true)
            .addChoices(...COUNTER_KINDS.map((kind) => ({ name: `serverstats.kinds.${kind}`, value: kind }))),
        )
        .addStringOption((o) => o.setName('name').setDescription('serverstats.command.options.name').setMaxLength(90))
        .addChannelOption((o) => o.setName('category').setDescription('serverstats.command.options.category').addChannelTypes(ChannelType.GuildCategory)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('serverstats.command.remove')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('serverstats.command.options.channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice),
        ),
    ),
  defer: 'ephemeral',
  permissions: { user: PermissionFlagsBits.ManageChannels, bot: PermissionFlagsBits.ManageChannels, allowStaff: true },
  async run(ctx) {
    const { options } = ctx.interaction;
    const { counters } = await ctx.bot.settings.module(ctx.guild.id, serverStatsSettings);

    if (options.getSubcommand() === 'remove') {
      const channel = options.getChannel('channel', true);
      if (!counters.some((c) => c.channelId === channel.id)) throw new UserError('serverstats.errors.notCounter');
      await ctx.bot.settings.updateModule(ctx.guild.id, serverStatsSettings, { counters: counters.filter((c) => c.channelId !== channel.id) });
      await ctx.guild.channels.delete(channel.id, 'Server stats counter removed').catch(() => undefined);
      await ctx.respond(ctx.successPanel(ctx.t('serverstats.removed')));
      return;
    }

    if (counters.length >= 10) throw new UserError('serverstats.errors.limit');
    const kind = options.getString('counter', true) as CounterKind;
    const template = options.getString('name') ?? ctx.t(`serverstats.templates.${kind}`);
    if (needsMemberList([kind])) await ctx.guild.members.fetch();
    const channel = await ctx.guild.channels.create({
      name: counterName(template, countFor(ctx.guild, kind), ctx.bot.guildLocale(ctx.settings)),
      type: ChannelType.GuildVoice,
      parent: options.getChannel('category')?.id ?? null,
      // Visible to everyone, joinable by no one: the channel exists only for its name.
      permissionOverwrites: [{ id: ctx.guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] }],
      reason: 'Server stats counter',
    });
    await ctx.bot.settings.updateModule(ctx.guild.id, serverStatsSettings, { counters: [...counters, { channelId: channel.id, kind, template }] });
    await ctx.respond(ctx.successPanel(ctx.t('serverstats.added', { channel: channel.toString() })));
  },
});

const memberAdd = defineEvent({
  name: Events.GuildMemberAdd,
  run: (bot, member) => refreshStats(bot, member.guild),
});

const memberRemove = defineEvent({
  name: Events.GuildMemberRemove,
  run: (bot, member) => refreshStats(bot, member.guild),
});

const channelDelete = defineEvent({
  name: Events.ChannelDelete,
  async run(bot, channel) {
    if (channel.isDMBased()) return;
    const { counters } = await bot.settings.module(channel.guild.id, serverStatsSettings);
    if (!counters.some((c) => c.channelId === channel.id)) return;
    // Someone deleted a counter channel by hand; forget it instead of failing to rename it forever.
    await bot.settings.updateModule(channel.guild.id, serverStatsSettings, { counters: counters.filter((c) => c.channelId !== channel.id) });
  },
});

let stopTicker: (() => void) | undefined;

export default defineModule({
  name: 'serverstats',
  toggleable: true,
  // Server Members is privileged: join and leave events and the human/bot split need it.
  intents: [GatewayIntentBits.GuildMembers],
  guildSettings: serverStatsSettings.guildSettings,
  commands: [serverstats],
  events: [memberAdd, memberRemove, channelDelete],
  start(bot) {
    stopTicker = startStatsTicker(bot);
  },
  stop() {
    stopTicker?.();
  },
});
