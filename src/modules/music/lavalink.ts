import type { EventEmitter } from 'node:events';
import { LavalinkManager, type Player } from 'lavalink-client';
import type { Bot } from '../../core/bot.js';
import { UserError } from '../../core/errors.js';
import { applyFilters, activeFilters } from './filters.js';
import { nowPlayingPanel, trackLink } from './nowplaying.js';
import { musicConfig, musicSettings } from './settings.js';
import { mongoQueueStore, SessionModel } from './store.js';

const SAVE_EVERY_MS = 15_000;

let manager: LavalinkManager | undefined;
let saver: NodeJS.Timeout | undefined;
let connectedOnce = false;
/** Guilds whose players are being torn down without ending the session (restarts, node moves). */
const keepSession = new Set<string>();
const idleTimers = new Map<string, NodeJS.Timeout>();

/** The ready Lavalink manager. Throws a friendly error while no Lavalink node is connected. */
export function lavalink(): LavalinkManager {
  if (!manager?.useable) throw new UserError('music.errors.offline');
  return manager;
}

export function playerFor(guildId: string): Player | undefined {
  return manager?.getPlayer(guildId);
}

async function context(bot: Bot, guildId: string) {
  const core = await bot.settings.get(guildId);
  const locale = bot.guildLocale(core);
  return {
    t: (key: string, vars?: Record<string, string | number>) => bot.i18n.t(locale, key, vars),
    color: core.color ?? bot.config.bot.color,
    settings: await bot.settings.module(guildId, musicSettings),
  };
}

export async function saveSession(player: Player): Promise<void> {
  if (!player.voiceChannelId) return;
  await SessionModel.updateOne(
    { guildId: player.guildId },
    {
      voiceChannelId: player.voiceChannelId,
      textChannelId: player.textChannelId,
      volume: player.volume,
      repeatMode: player.repeatMode,
      paused: player.paused,
      position: player.queue.current ? Math.floor(player.position) : 0,
      filters: activeFilters(player),
    },
    { upsert: true },
  );
}

/** Ends playback for good: leaves the channel and forgets the queue and session. */
export async function endSession(guildId: string, reason: string): Promise<void> {
  clearIdle(guildId);
  const player = manager?.getPlayer(guildId);
  if (player) await player.destroy(reason, true);
  await SessionModel.deleteOne({ guildId });
  await mongoQueueStore.delete(guildId);
}

export function clearIdle(guildId: string): void {
  const timer = idleTimers.get(guildId);
  if (timer) clearTimeout(timer);
  idleTimers.delete(guildId);
}

/** Leaves after `seconds` unless something cancels it (a new track, someone joining, 24/7 mode). */
export function scheduleLeave(bot: Bot, guildId: string, seconds: number, reason: string): void {
  clearIdle(guildId);
  const timer = setTimeout(() => {
    idleTimers.delete(guildId);
    void (async () => {
      const { settings } = await context(bot, guildId);
      if (settings.alwaysOn) return;
      await endSession(guildId, reason);
    })().catch((err) => bot.logger.warn({ err, guild: guildId }, 'idle leave failed'));
  }, seconds * 1000);
  timer.unref();
  idleTimers.set(guildId, timer);
}

/** Posts a fresh now-playing message and removes the previous one, so the controls stay at the bottom. */
async function announce(bot: Bot, player: Player): Promise<void> {
  const { t, color, settings } = await context(bot, player.guildId);
  if (!settings.announce || !player.textChannelId) return;
  const channel = bot.client.channels.cache.get(player.textChannelId);
  if (!channel?.isSendable()) return;

  const previousId = player.get<string | undefined>('nowPlayingMessage');
  if (previousId && 'messages' in channel) await channel.messages.delete(previousId).catch(() => undefined);
  const message = await channel.send({ ...nowPlayingPanel(bot, player, t, color).render(), allowedMentions: { parse: [] } }).catch(() => null);
  if (message) player.set('nowPlayingMessage', message.id);
}

async function notice(bot: Bot, player: Player, key: string, vars: Record<string, string | number> = {}): Promise<void> {
  if (!player.textChannelId) return;
  const { t, color } = await context(bot, player.guildId);
  const channel = bot.client.channels.cache.get(player.textChannelId);
  if (channel?.isSendable()) await channel.send({ ...bot.panel(color).text(t(key, vars)).render(), allowedMentions: { parse: [] } }).catch(() => undefined);
}

/**
 * Brings back every session saved before the last shutdown: rejoins the voice channel, loads
 * the queue from MongoDB and continues the current track from where it was.
 */
async function restoreSessions(bot: Bot): Promise<void> {
  const sessions = await SessionModel.find().lean();
  let restored = 0;
  for (const session of sessions) {
    const guild = bot.client.guilds.cache.get(session.guildId);
    const channel = guild?.channels.cache.get(session.voiceChannelId);
    if (!guild || !channel?.isVoiceBased()) {
      await endSession(session.guildId, 'restore: channel gone');
      continue;
    }
    const { settings } = await context(bot, guild.id);
    const listeners = channel.members.filter((m) => !m.user.bot).size;
    if (listeners === 0 && !settings.alwaysOn) {
      await endSession(guild.id, 'restore: nobody listening');
      continue;
    }

    try {
      if (manager!.getPlayer(guild.id)) {
        keepSession.add(guild.id);
        await manager!.getPlayer(guild.id)!.destroy('restore', false);
        keepSession.delete(guild.id);
      }
      const player = manager!.createPlayer({
        guildId: guild.id,
        voiceChannelId: session.voiceChannelId,
        textChannelId: session.textChannelId ?? undefined,
        volume: session.volume,
        selfDeaf: true,
      });
      await player.connect();
      await player.queue.utils.sync(true, false);
      await player.setRepeatMode(session.repeatMode);
      if (player.queue.current || player.queue.tracks.length > 0) {
        await player.play({
          ...(player.queue.current ? { clientTrack: player.queue.current } : {}),
          position: session.position,
          paused: session.paused,
        });
        await applyFilters(player, session.filters);
      }
      restored++;
    } catch (err) {
      bot.logger.warn({ err, guild: guild.id }, 'could not restore music session');
      await endSession(guild.id, 'restore failed').catch(() => undefined);
    }
  }
  if (restored > 0) bot.logger.info({ restored }, 'music sessions restored');
}

export async function startLavalink(bot: Bot): Promise<void> {
  const { env } = bot;
  const config = bot.moduleConfig({ name: 'music', config: musicConfig });
  const client = bot.client;

  manager = new LavalinkManager({
    nodes: [
      {
        id: 'main',
        host: env.LAVALINK_HOST,
        port: env.LAVALINK_PORT,
        authorization: env.LAVALINK_PASSWORD,
        secure: env.LAVALINK_SECURE,
        // Keep trying forever: Lavalink restarts (or starts later than the bot in Docker) are normal.
        retryAmount: Number.MAX_SAFE_INTEGER,
        retryDelay: 15_000,
      },
    ],
    sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard.send(payload),
    autoSkip: true,
    client: { id: client.user!.id, username: client.user!.username },
    playerOptions: {
      defaultSearchPlatform: config.defaultSearch,
      // Stored with each track: just enough to show who asked for it, and small in MongoDB.
      requesterTransformer: (user) => {
        const u = user as { id?: string; username?: string };
        return { id: u.id ?? '', username: u.username ?? '' };
      },
      onDisconnect: { autoReconnect: true, destroyPlayer: false },
    },
    queueOptions: { maxPreviousTracks: 25, queueStore: mongoQueueStore },
  });

  manager.nodeManager.on('connect', (node) => {
    bot.logger.info({ node: node.id }, 'lavalink connected');
    // Both the first connect after startup and a reconnect after Lavalink restarted lose the
    // players on the Lavalink side, so the saved sessions are replayed either way.
    void restoreSessions(bot).catch((err) => bot.logger.error({ err }, 'music restore failed'));
    connectedOnce = true;
  });
  manager.nodeManager.on('disconnect', (node, reason) => bot.logger.warn({ node: node.id, reason }, 'lavalink disconnected'));
  manager.nodeManager.on('reconnecting', (node) => bot.logger.info({ node: node.id }, 'lavalink reconnecting'));
  let warnedUnreachable = false;
  manager.nodeManager.on('error', (node, err) => {
    // Before the first connection this is almost always "Lavalink isn't running (yet)". Say so
    // once, plainly, instead of logging a stack trace every retry.
    if (!connectedOnce) {
      if (!warnedUnreachable) bot.logger.warn(`lavalink not reachable at ${env.LAVALINK_HOST}:${env.LAVALINK_PORT}, retrying every 15s`);
      warnedUnreachable = true;
      return;
    }
    bot.logger.warn({ node: node.id, err }, 'lavalink error');
  });

  manager.on('trackStart', (player) => {
    clearIdle(player.guildId);
    void announce(bot, player).catch((err) => bot.logger.debug({ err }, 'now playing post failed'));
    void saveSession(player).catch(() => undefined);
  });
  manager.on('trackError', (player, track) => {
    if (track) void notice(bot, player, 'music.errors.trackFailed', { track: trackLink(track) });
  });
  manager.on('trackStuck', (player, track) => {
    if (track) void notice(bot, player, 'music.errors.trackFailed', { track: trackLink(track) });
  });
  manager.on('queueEnd', (player) => {
    void (async () => {
      const { settings } = await context(bot, player.guildId);
      await notice(bot, player, settings.alwaysOn ? 'music.queueEnd.alwaysOn' : 'music.queueEnd.leaving', {
        minutes: Math.ceil(config.idleSeconds / 60),
      });
      if (!settings.alwaysOn) scheduleLeave(bot, player.guildId, config.idleSeconds, 'queue empty');
      await saveSession(player);
    })().catch((err) => bot.logger.debug({ err }, 'queue end handling failed'));
  });
  manager.on('playerDisconnect', (player) => {
    // Disconnected by hand (or the channel was deleted): treat it as a stop.
    if (!keepSession.has(player.guildId) && !bot.stopping) void endSession(player.guildId, 'disconnected').catch(() => undefined);
  });
  manager.on('playerDestroy', (player) => {
    clearIdle(player.guildId);
    if (keepSession.has(player.guildId) || bot.stopping) return;
    void SessionModel.deleteOne({ guildId: player.guildId }).catch(() => undefined);
  });

  // Lavalink needs the raw voice events, which discord.js doesn't expose as typed events.
  (client as unknown as EventEmitter).on('raw', (data: Parameters<LavalinkManager['sendRawData']>[0]) => {
    void manager?.sendRawData(data);
  });

  saver = setInterval(() => {
    for (const player of manager?.players.values() ?? []) {
      if (player.playing) void saveSession(player).catch(() => undefined);
    }
  }, SAVE_EVERY_MS);
  saver.unref();

  await manager.init({ id: client.user!.id, username: client.user!.username });
}

/** Saves every session on shutdown. Players aren't destroyed, so the next start can resume them. */
export async function stopLavalink(): Promise<void> {
  if (saver) clearInterval(saver);
  for (const timer of idleTimers.values()) clearTimeout(timer);
  idleTimers.clear();
  await Promise.all([...(manager?.players.values() ?? [])].map((p) => saveSession(p).catch(() => undefined)));
}

