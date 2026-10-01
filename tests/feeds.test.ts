import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Bot } from '../src/core/bot.js';
import { I18n } from '../src/core/i18n.js';
import { fromRoot } from '../src/core/paths.js';
import { FeedModel } from '../src/modules/feeds/model.js';
import { checkYouTube, fillAnnouncement } from '../src/modules/feeds/poll.js';
import { parseTwitchLogin, TwitchClient } from '../src/modules/feeds/twitch.js';
import { channelIdFromPage, decodeXml, parseChannelInput, parseFeed } from '../src/modules/feeds/youtube.js';

const xml = readFileSync(fromRoot('tests', 'fixtures', 'youtube-feed.xml'), 'utf8');
const CHANNEL = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';

describe('youtube parsing', () => {
  it('reads the channel name and videos, newest first', () => {
    const feed = parseFeed(xml);
    expect(feed.name).toBe('Google for Developers');
    expect(feed.videos.map((v) => v.id)).toEqual(['short000001', 'video000002', 'video000003']);
    expect(feed.videos[0]).toMatchObject({ title: '60 seconds of Q&A', isShort: true, url: 'https://www.youtube.com/shorts/short000001' });
    expect(feed.videos[1]!.title).toBe("What's new in <Tools> — part 2");
    expect(feed.videos[1]!.published.toISOString()).toBe('2026-06-01T12:00:00.000Z');
  });

  it('understands the ways people paste a channel', () => {
    expect(parseChannelInput(CHANNEL)).toEqual({ channelId: CHANNEL });
    expect(parseChannelInput(`https://www.youtube.com/channel/${CHANNEL}/videos`)).toEqual({ channelId: CHANNEL });
    expect(parseChannelInput('@GoogleDevelopers')).toEqual({ handle: 'GoogleDevelopers' });
    expect(parseChannelInput('https://youtube.com/@GoogleDevelopers/')).toEqual({ handle: 'GoogleDevelopers' });
    expect(parseChannelInput('not a channel at all')).toBeNull();
  });

  it('finds the channel ID on a channel page', () => {
    expect(channelIdFromPage(`<link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL}">`)).toBe(CHANNEL);
    expect(channelIdFromPage(`{"metadata":{"externalId":"${CHANNEL}"}}`)).toBe(CHANNEL);
    expect(channelIdFromPage('<html>consent</html>')).toBeNull();
  });

  it('decodes XML entities', () => {
    expect(decodeXml('a &amp; b &#39;c&#39; &#x1F600; &unknown;')).toBe("a & b 'c' \u{1F600} &unknown;");
  });
});

describe('twitch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses logins and links', () => {
    expect(parseTwitchLogin('https://www.twitch.tv/Some_Streamer/')).toBe('some_streamer');
    expect(parseTwitchLogin('@name')).toBe('name');
    expect(parseTwitchLogin('two words')).toBeNull();
  });

  it('gets a token, lists live streams, and retries once with a new token after a 401', async () => {
    let tokens = 0;
    let streamCalls = 0;
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.startsWith('https://id.twitch.tv/')) {
        tokens++;
        return Response.json({ access_token: `t${tokens}`, expires_in: 3600 });
      }
      streamCalls++;
      if (streamCalls === 2) return new Response('expired', { status: 401 });
      return Response.json({
        data: [
          { id: 's1', user_id: '1', user_login: 'alpha', user_name: 'Alpha', title: 'Ranked', game_name: 'Chess', started_at: '2026-06-01T10:00:00Z', type: 'live' },
          { id: 's2', user_id: '2', user_login: 'beta', user_name: 'Beta', title: 'Rerun', game_name: '', started_at: '2026-06-01T10:00:00Z', type: '' },
        ],
      });
    });
    vi.stubGlobal('fetch', fetch);
    const client = new TwitchClient('id', 'secret');

    const live = await client.liveStreams(['1', '2']);
    expect([...live.keys()]).toEqual(['1']);
    expect(live.get('1')).toMatchObject({ login: 'alpha', game: 'Chess' });
    expect(String(fetch.mock.calls[1]![0])).toContain('user_id=1&user_id=2');

    await client.liveStreams(['1']);
    expect(tokens).toBe(2);
    const auth = fetch.mock.calls.at(-1)![1]!.headers as Record<string, string>;
    expect(auth.authorization).toBe('Bearer t2');
  });
});

describe('fillAnnouncement', () => {
  it('fills known placeholders only', () => {
    expect(fillAnnouncement('{name} {title} {url} {game} {other}', { name: 'A', title: 'B', url: 'C', game: 'D' })).toBe('A B C D {other}');
  });
});

// Needs a real MongoDB. Run with MONGODB_TEST_URI=mongodb://127.0.0.1:27017/bot-test npm test
const uri = process.env.MONGODB_TEST_URI;

describe.skipIf(!uri)('checkYouTube', () => {
  const guildId = `f${Date.now()}`;
  const send = vi.fn(async (_options: { content: string }) => ({}));
  const bot = {
    logger: pino({ level: 'silent' }),
    i18n: I18n.fromDirectory(fromRoot('locales'), 'en'),
    settings: { get: async () => ({}) },
    guildLocale: () => 'en',
    isEnabled: () => true,
    moduleConfig: () => ({ maxVideoAgeHours: 48 }),
    client: { guilds: { cache: new Map([[guildId, { id: guildId, channels: { cache: new Map([
      ['c', { isSendable: () => true, send }],
      ['c2', { isSendable: () => true, send }],
    ]) } }]]) } },
  } as unknown as Bot;
  const base = { guildId, platform: 'youtube' as const, sourceId: CHANNEL, sourceName: 'Google for Developers', sourceUrl: 'u', roleId: 'r' };

  beforeAll(async () => {
    await mongoose.connect(uri!);
    await FeedModel.create([
      { ...base, number: 1, channelId: 'c', includeShorts: false, seen: ['video000003'] },
      { ...base, number: 2, channelId: 'c2', includeShorts: true, seen: ['video000002'] },
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(xml)));
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await FeedModel.deleteMany({ guildId });
    await mongoose.disconnect();
  });

  it('posts unseen recent videos once, honouring the Shorts setting', async () => {
    const now = new Date('2026-06-02T00:00:00Z');
    await Promise.all([checkYouTube(bot, now), checkYouTube(bot, now)]);
    await checkYouTube(bot, now);
    const posted = send.mock.calls.map(([options]) => options.content);
    expect(posted).toHaveLength(2);
    expect(posted.some((c) => c.includes('watch?v=video000002'))).toBe(true);
    expect(posted.some((c) => c.includes('shorts/short000001'))).toBe(true);
    expect(posted.every((c) => c.startsWith('<@&r>'))).toBe(true);
    // The old talk is outside the age limit, so it's never posted.
    expect(posted.some((c) => c.includes('video000003'))).toBe(false);
  });
});
