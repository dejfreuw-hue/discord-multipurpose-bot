import { roleMention } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { FeedModel, markLive, markSeen, type FeedDoc } from './model.js';
import { feedsConfig } from './settings.js';
import { TwitchClient } from './twitch.js';
import { fetchFeed } from './youtube.js';

type StoredFeed = FeedDoc & { _id: unknown };

export interface AnnouncementVars {
  name: string;
  title: string;
  url: string;
  game: string;
}

let twitch: TwitchClient | null | undefined;

/** Null when the owner hasn't put Twitch app credentials in .env. */
export function twitchClient(bot: Bot): TwitchClient | null {
  if (twitch === undefined) {
    const { TWITCH_CLIENT_ID: id, TWITCH_CLIENT_SECRET: secret } = bot.env;
    twitch = id && secret ? new TwitchClient(id, secret) : null;
  }
  return twitch;
}

export function fillAnnouncement(template: string, vars: AnnouncementVars): string {
  return template.replace(/\{(name|title|url|game)\}/g, (_, key: keyof AnnouncementVars) => vars[key]);
}

export async function announce(bot: Bot, feed: FeedDoc, vars: AnnouncementVars): Promise<boolean> {
  const guild = bot.client.guilds.cache.get(feed.guildId);
  if (!guild) return false;
  const settings = await bot.settings.get(guild.id);
  if (!bot.isEnabled('feeds', settings)) return false;
  const channel = guild.channels.cache.get(feed.channelId);
  if (!channel?.isSendable()) return false;

  const key = feed.platform === 'twitch' && !vars.game ? 'feeds.announce.twitchNoGame' : `feeds.announce.${feed.platform}`;
  let text = feed.message ? fillAnnouncement(feed.message, vars) : bot.i18n.t(bot.guildLocale(settings), key, { ...vars });
  // The link is what makes Discord show the video or stream preview, so it's always there.
  if (!text.includes(vars.url)) text += `\n${vars.url}`;
  const content = feed.roleId ? `${roleMention(feed.roleId)} ${text}` : text;
  const sent = await channel
    .send({ content: content.slice(0, 2000), allowedMentions: { parse: [], roles: feed.roleId ? [feed.roleId] : [] } })
    .catch(() => null);
  return Boolean(sent);
}

export async function checkYouTube(bot: Bot, now = new Date()): Promise<void> {
  const { maxVideoAgeHours } = bot.moduleConfig({ name: 'feeds', config: feedsConfig });
  const sources = (await FeedModel.distinct('sourceId', { platform: 'youtube' })) as string[];
  for (const sourceId of sources) {
    const feed = await fetchFeed(sourceId).catch((err: unknown) => {
      bot.logger.debug({ err, sourceId }, 'youtube feed fetch failed');
      return null;
    });
    if (!feed) continue;
    const fresh = feed.videos.filter((v) => now.getTime() - v.published.getTime() < maxVideoAgeHours * 3_600_000).reverse();
    if (fresh.length === 0) continue;

    const subscribers = await FeedModel.find({ platform: 'youtube', sourceId }).lean<StoredFeed[]>();
    for (const doc of subscribers) {
      for (const video of fresh) {
        if (doc.seen.includes(video.id) || (video.isShort && !doc.includeShorts)) continue;
        if (!(await markSeen(doc, video.id))) continue;
        await announce(bot, doc, { name: feed.name, title: video.title, url: video.url, game: '' });
      }
    }
  }
}

export async function checkTwitch(bot: Bot): Promise<void> {
  const client = twitchClient(bot);
  if (!client) return;
  const sources = (await FeedModel.distinct('sourceId', { platform: 'twitch' })) as string[];
  if (sources.length === 0) return;
  const live = await client.liveStreams(sources);
  if (live.size === 0) return;

  const subscribers = await FeedModel.find({ platform: 'twitch', sourceId: { $in: [...live.keys()] } }).lean<StoredFeed[]>();
  for (const doc of subscribers) {
    const stream = live.get(doc.sourceId)!;
    if (doc.lastStreamId === stream.id || !(await markLive(doc, stream.id))) continue;
    await announce(bot, doc, { name: stream.displayName, title: stream.title, url: `https://www.twitch.tv/${stream.login}`, game: stream.game });
  }
}

function every(bot: Bot, name: string, intervalMs: number, task: () => Promise<void>): () => void {
  let running = false;
  const tick = async () => {
    if (running || bot.stopping) return;
    running = true;
    try {
      await task();
    } catch (err) {
      bot.logger.warn({ err }, `${name} check failed`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

/** Starts both pollers; returns a function that stops them. */
export function startFeedPolling(bot: Bot): () => void {
  const config = bot.moduleConfig({ name: 'feeds', config: feedsConfig });
  const stops = [every(bot, 'youtube', config.youtubeIntervalMinutes * 60_000, () => checkYouTube(bot))];
  if (twitchClient(bot)) stops.push(every(bot, 'twitch', config.twitchIntervalSeconds * 1000, () => checkTwitch(bot)));
  return () => stops.forEach((stop) => stop());
}
