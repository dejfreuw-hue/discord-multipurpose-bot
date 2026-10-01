import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Collection } from 'discord.js';
import mongoose from 'mongoose';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { Bot } from '../src/core/bot.js';
import { GuildSettings } from '../src/core/guild-settings.js';
import { I18n } from '../src/core/i18n.js';
import { fromRoot } from '../src/core/paths.js';
import { Panel } from '../src/core/ui/panel.js';
import { activeFilters } from '../src/modules/music/filters.js';
import { endSession, playerFor, saveSession, startLavalink, stopLavalink } from '../src/modules/music/lavalink.js';
import { musicConfig } from '../src/modules/music/settings.js';
import { mongoQueueStore, SessionModel } from '../src/modules/music/store.js';

// Needs a real MongoDB. Run with MONGODB_TEST_URI=mongodb://127.0.0.1:27017/bot-test npm test
const uri = process.env.MONGODB_TEST_URI;

const track = (id: string) => ({
  encoded: `encoded-${id}`,
  info: {
    identifier: id,
    title: `Song ${id}`,
    author: 'Artist',
    duration: 200_000,
    artworkUrl: null,
    uri: `https://example.com/${id}`,
    sourceName: 'youtube',
    isSeekable: true,
    isStream: false,
    isrc: null,
  },
  pluginInfo: {},
  requester: { id: 'u1', username: 'ana' },
});

interface Recorded {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

/** A tiny stand-in for a Lavalink v4 server: the websocket handshake plus the REST calls the bot makes. */
function fakeLavalink(): Promise<{ server: Server; port: number; requests: Recorded[] }> {
  const requests: Recorded[] = [];
  const read = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => resolve(data));
    });

  const server = createServer(async (req, res) => {
    const raw = await read(req);
    const path = (req.url ?? '').replace(/^\/v4/, '');
    requests.push({ method: req.method ?? '', path, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null });
    res.setHeader('content-type', 'application/json');
    if (path.startsWith('/info')) {
      res.end(JSON.stringify({ version: { semver: '4.1.1', major: 4, minor: 1, patch: 1 }, sourceManagers: ['youtube', 'http'], filters: ['timescale', 'rotation', 'equalizer', 'karaoke'], plugins: [], jvm: '21', lavaplayer: '2', git: {}, buildTime: 0 }));
    } else if (path.startsWith('/loadtracks')) {
      res.end(JSON.stringify({ loadType: 'search', data: [track('found')] }));
    } else if (path.startsWith('/sessions/') && path.includes('/players/') && req.method === 'PATCH') {
      const body = raw ? JSON.parse(raw) : {};
      res.end(JSON.stringify({ guildId: path.split('/').pop()?.split('?')[0], track: body.track ?? null, volume: body.volume ?? 100, paused: Boolean(body.paused), state: { time: Date.now(), position: body.position ?? 0, connected: true, ping: 1 }, voice: {}, filters: body.filters ?? {} }));
    } else if (req.method === 'DELETE') {
      res.statusCode = 204;
      res.end();
    } else {
      res.end('{}');
    }
  });
  const wss = new WebSocketServer({ server, path: '/v4/websocket' });
  wss.on('connection', (socket) => socket.send(JSON.stringify({ op: 'ready', resumed: false, sessionId: 'session-1' })));

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port, requests })));
}

async function waitFor<T>(check: () => T | undefined, timeoutMs = 8000): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
}

describe.skipIf(!uri)('music resume against a fake Lavalink', () => {
  let lavalink: Awaited<ReturnType<typeof fakeLavalink>>;
  const logger = pino({ level: 'silent' });
  const guildId = `g${Date.now()}`;

  beforeAll(async () => {
    await mongoose.connect(uri!);
    lavalink = await fakeLavalink();
  });

  afterAll(async () => {
    await stopLavalink();
    lavalink.server.close();
    await mongoose.disconnect();
  });

  it('rejoins and continues the saved track at the saved position', async () => {
    await SessionModel.create({ guildId, voiceChannelId: 'vc1', textChannelId: null, volume: 50, repeatMode: 'queue', paused: false, position: 42_000, filters: ['nightcore'] });
    await mongoQueueStore.set(guildId, JSON.stringify({ current: track('a'), previous: [], tracks: [track('b')] }));

    const shardSend = vi.fn();
    const voiceChannel = { id: 'vc1', isVoiceBased: () => true, members: new Collection([['u1', { user: { bot: false } }]]) };
    const guild = { id: guildId, shard: { send: shardSend }, channels: { cache: new Map([['vc1', voiceChannel]]) } };
    const client = Object.assign(new EventEmitter(), {
      user: { id: '111111111111111111', username: 'bot' },
      guilds: { cache: new Map([[guildId, guild]]) },
      channels: { cache: new Map() },
    });
    const bot = {
      client,
      logger,
      stopping: false,
      env: { LAVALINK_HOST: '127.0.0.1', LAVALINK_PORT: lavalink.port, LAVALINK_PASSWORD: 'x', LAVALINK_SECURE: false },
      settings: new GuildSettings(logger),
      i18n: I18n.fromDirectory(fromRoot('locales'), 'en'),
      config: { bot: { locale: 'en', color: 0 } },
      moduleConfig: () => musicConfig.parse({}),
      guildLocale: () => 'en',
      panel: () => new Panel(0, true),
    } as unknown as Bot;

    await startLavalink(bot);

    const play = await waitFor(() =>
      lavalink.requests.find((r) => r.method === 'PATCH' && r.path.includes(`/players/${guildId}`) && (r.body?.track as { encoded?: string })?.encoded),
    );
    expect((play.body!.track as { encoded: string }).encoded).toBe('encoded-a');
    expect(play.body!.position).toBe(42_000);
    expect(shardSend).toHaveBeenCalledWith(expect.objectContaining({ op: 4, d: expect.objectContaining({ guild_id: guildId, channel_id: 'vc1' }) }));

    const player = playerFor(guildId)!;
    expect(player.repeatMode).toBe('queue');
    expect(player.volume).toBe(50);
    expect(player.queue.tracks.map((t) => t.info.identifier)).toEqual(['b']);

    // The saved nightcore filter is sent to Lavalink again.
    await waitFor(() => lavalink.requests.find((r) => r.method === 'PATCH' && (r.body?.filters as { timescale?: unknown })?.timescale));
    expect(activeFilters(player)).toContain('nightcore');

    await saveSession(player);
    expect(await SessionModel.findOne({ guildId }).lean()).toMatchObject({ repeatMode: 'queue', volume: 50, filters: ['nightcore'] });
  });

  it('searches and queues new tracks into the stored queue', async () => {
    const player = playerFor(guildId)!;
    const result = await player.search({ query: 'something', source: 'ytsearch' }, { id: 'u2', username: 'ben' });
    expect(result.tracks[0]?.info.identifier).toBe('found');
    await player.queue.add(result.tracks[0]!);
    const stored = JSON.parse((await mongoQueueStore.get(guildId))!);
    expect(stored.tracks.map((t: { info: { identifier: string } }) => t.info.identifier)).toEqual(['b', 'found']);
    expect(stored.tracks[1].requester).toEqual({ id: 'u2', username: 'ben' });
  });

  it('forgets everything when playback is stopped', async () => {
    await endSession(guildId, 'test');
    expect(playerFor(guildId)).toBeUndefined();
    expect(await SessionModel.findOne({ guildId }).lean()).toBeNull();
    expect(await mongoQueueStore.get(guildId)).toBeUndefined();
    expect(lavalink.requests.some((r) => r.method === 'DELETE' && r.path.includes(`/players/${guildId}`))).toBe(true);
  });
});
