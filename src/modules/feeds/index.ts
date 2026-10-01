import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';
import { UserError } from '../../core/errors.js';
import { nextSequence } from '../../core/models/counter.js';
import { defineCommand, defineModule } from '../../core/module.js';
import { FeedModel, type FeedDoc, type Platform } from './model.js';
import { announce, startFeedPolling, twitchClient } from './poll.js';
import { feedsConfig } from './settings.js';
import { parseTwitchLogin } from './twitch.js';
import { fetchFeed, resolveChannel } from './youtube.js';

function deliveryOptions(s: SlashCommandSubcommandBuilder) {
  return s
    .addChannelOption((o) =>
      o.setName('post_in').setDescription('feeds.command.options.postIn').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addRoleOption((o) => o.setName('ping').setDescription('feeds.command.options.ping'))
    .addStringOption((o) => o.setName('message').setDescription('feeds.command.options.message').setMaxLength(500));
}

async function feedAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guildId) return interaction.respond([]);
  const feeds = await FeedModel.find({ guildId: interaction.guildId }).sort({ number: 1 }).limit(25).lean<FeedDoc[]>();
  await interaction.respond(feeds.map((f) => ({ name: `#${f.number} ${f.platform}: ${f.sourceName}`.slice(0, 100), value: f.number })));
}

const feed = defineCommand({
  data: new SlashCommandBuilder()
    .setName('feed')
    .setDescription('feeds.command.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      deliveryOptions(
        s
          .setName('youtube')
          .setDescription('feeds.command.youtube')
          .addStringOption((o) => o.setName('channel').setDescription('feeds.command.options.youtubeChannel').setRequired(true).setMaxLength(200)),
      ).addBooleanOption((o) => o.setName('shorts').setDescription('feeds.command.options.shorts')),
    )
    .addSubcommand((s) =>
      deliveryOptions(
        s
          .setName('twitch')
          .setDescription('feeds.command.twitch')
          .addStringOption((o) => o.setName('streamer').setDescription('feeds.command.options.streamer').setRequired(true).setMaxLength(100)),
      ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('feeds.command.remove')
        .addIntegerOption((o) => o.setName('feed').setDescription('feeds.command.options.feed').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('test')
        .setDescription('feeds.command.test')
        .addIntegerOption((o) => o.setName('feed').setDescription('feeds.command.options.feed').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('feeds.command.list')),
  defer: 'ephemeral',
  permissions: { user: PermissionFlagsBits.ManageGuild, allowStaff: true },
  autocomplete: feedAutocomplete,
  async run(ctx) {
    const { options } = ctx.interaction;
    const sub = options.getSubcommand();
    const guildId = ctx.guild.id;

    if (sub === 'list') {
      const feeds = await FeedModel.find({ guildId }).sort({ number: 1 }).lean<FeedDoc[]>();
      const lines = feeds.map((f) => `**#${f.number}** ${ctx.t(`feeds.platforms.${f.platform}`)}: ${f.sourceName} -> <#${f.channelId}>`);
      await ctx.respond(ctx.panel().title(ctx.t('feeds.listTitle')).text(lines.join('\n') || ctx.t('feeds.empty')));
      return;
    }

    if (sub === 'remove' || sub === 'test') {
      const number = options.getInteger('feed', true);
      const doc = await FeedModel.findOne({ guildId, number }).lean<FeedDoc>();
      if (!doc) throw new UserError('feeds.errors.notFound', { number });
      if (sub === 'remove') {
        await FeedModel.deleteOne({ guildId, number });
        await ctx.respond(ctx.successPanel(ctx.t('feeds.removed', { name: doc.sourceName })));
        return;
      }
      const latest = doc.platform === 'youtube' ? (await fetchFeed(doc.sourceId)).videos[0] : null;
      const posted = await announce(ctx.bot, doc, {
        name: doc.sourceName,
        title: latest?.title ?? ctx.t('feeds.testTitle'),
        url: latest?.url ?? doc.sourceUrl,
        game: ctx.t('feeds.testGame'),
      });
      if (!posted) throw new UserError('feeds.errors.cantPost', { channel: `<#${doc.channelId}>` });
      await ctx.respond(ctx.successPanel(ctx.t('feeds.tested', { channel: `<#${doc.channelId}>` })));
      return;
    }

    const { maxPerGuild } = ctx.bot.moduleConfig({ name: 'feeds', config: feedsConfig });
    if ((await FeedModel.countDocuments({ guildId })) >= maxPerGuild) throw new UserError('feeds.errors.limit', { count: maxPerGuild });
    const target = options.getChannel('post_in', true);
    const base = {
      guildId,
      channelId: target.id,
      roleId: options.getRole('ping')?.id ?? null,
      message: options.getString('message'),
    };

    let source: { sourceId: string; sourceName: string; sourceUrl: string; seen?: string[]; lastStreamId?: string | null };
    const platform = sub as Platform;
    if (platform === 'youtube') {
      const input = options.getString('channel', true);
      const channel = await resolveChannel(input);
      if (!channel) throw new UserError('feeds.errors.youtubeNotFound', { input: input.slice(0, 100) });
      // Everything already on the channel counts as seen, so adding a feed doesn't post a backlog.
      source = {
        sourceId: channel.channelId,
        sourceName: channel.name,
        sourceUrl: `https://www.youtube.com/channel/${channel.channelId}`,
        seen: channel.videos.map((v) => v.id),
      };
    } else {
      const client = twitchClient(ctx.bot);
      if (!client) throw new UserError('feeds.errors.twitchNotSetUp');
      const login = parseTwitchLogin(options.getString('streamer', true));
      const user = login ? await client.userByLogin(login) : null;
      if (!user) throw new UserError('feeds.errors.twitchNotFound', { input: options.getString('streamer', true).slice(0, 100) });
      // Same idea for a stream that's already running when the feed is added.
      const live = (await client.liveStreams([user.id])).get(user.id);
      source = {
        sourceId: user.id,
        sourceName: user.displayName,
        sourceUrl: `https://www.twitch.tv/${user.login}`,
        lastStreamId: live?.id ?? null,
      };
    }

    if (await FeedModel.exists({ guildId, platform, sourceId: source.sourceId, channelId: target.id })) {
      throw new UserError('feeds.errors.duplicate', { name: source.sourceName, channel: `<#${target.id}>` });
    }
    const number = await nextSequence(`feed:${guildId}`);
    await FeedModel.create({ ...base, ...source, platform, number, includeShorts: options.getBoolean('shorts') ?? true });
    await ctx.respond(
      ctx.successPanel(ctx.t(`feeds.added.${platform}`, { name: source.sourceName, channel: `<#${target.id}>`, number, command: ctx.bot.commandMention('feed test') })),
    );
  },
});

let stopPolling: (() => void) | undefined;

export default defineModule({
  name: 'feeds',
  toggleable: true,
  config: feedsConfig,
  commands: [feed],
  start(bot) {
    stopPolling = startFeedPolling(bot);
  },
  stop() {
    stopPolling?.();
  },
});
