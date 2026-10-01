import type { Guild } from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import { throttler } from '../../../core/throttle.js';
import { countFor, counterName, needsMemberList } from './counters.js';
import { serverStatsSettings } from './settings.js';

// Discord allows two channel renames per 10 minutes; one every 5.5 minutes stays clear of it.
const RENAME_INTERVAL = 330_000;
const throttled = throttler(RENAME_INTERVAL);

async function refreshNow(bot: Bot, guild: Guild): Promise<void> {
  const core = await bot.settings.get(guild.id);
  if (!bot.isEnabled('serverstats', core)) return;
  const { counters } = await bot.settings.module(guild.id, serverStatsSettings);
  if (counters.length === 0) return;
  if (needsMemberList(counters.map((c) => c.kind)) && guild.members.cache.size < guild.memberCount) {
    await guild.members.fetch().catch(() => undefined);
  }
  const locale = bot.guildLocale(core);
  for (const counter of counters) {
    const channel = guild.channels.cache.get(counter.channelId);
    if (!channel || channel.isThread() || channel.isDMBased()) continue;
    const name = counterName(counter.template, countFor(guild, counter.kind), locale);
    if (channel.name !== name) await channel.setName(name, 'Server stats').catch(() => undefined);
  }
}

/** Updates a server's counter channels soon, without going over Discord's rename limit. */
export function refreshStats(bot: Bot, guild: Guild): void {
  throttled(guild.id, () => refreshNow(bot, guild));
}

/** Refreshes every server on a timer, for counts that change without an event (boosts, roles). */
export function startStatsTicker(bot: Bot): () => void {
  const run = () => {
    for (const guild of bot.client.guilds.cache.values()) refreshStats(bot, guild);
  };
  run();
  const timer = setInterval(run, RENAME_INTERVAL * 2);
  timer.unref();
  return () => clearInterval(timer);
}
