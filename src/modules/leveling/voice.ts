import type { Bot } from '../../core/bot.js';
import { grantXp, isIgnored, multiplierFor } from './xp.js';
import { levelingSettings } from './settings.js';

export interface VoiceMember {
  userId: string;
  channelId: string;
  bot: boolean;
  /** Self or server deafened: not taking part. */
  deaf: boolean;
}

/**
 * Members who earn voice XP this tick: not bots, not deafened, not in the AFK channel, and when
 * `requireOthers` is on, sharing the channel with at least one other eligible human.
 */
export function eligibleVoiceMembers(members: readonly VoiceMember[], afkChannelId: string | null, requireOthers: boolean): string[] {
  const active = members.filter((m) => !m.bot && !m.deaf && m.channelId !== afkChannelId);
  const perChannel = new Map<string, number>();
  for (const m of active) perChannel.set(m.channelId, (perChannel.get(m.channelId) ?? 0) + 1);
  return active.filter((m) => !requireOthers || (perChannel.get(m.channelId) ?? 0) >= 2).map((m) => m.userId);
}

/** Awards voice XP on a fixed tick, reading who is connected from the voice state cache. */
export function startVoiceTicker(bot: Bot, tickSeconds: number): () => void {
  let running = false;
  const tick = async () => {
    if (running || bot.stopping) return;
    running = true;
    try {
      for (const guild of bot.client.guilds.cache.values()) {
        if (guild.voiceStates.cache.size === 0) continue;
        const core = await bot.settings.get(guild.id);
        if (!bot.isEnabled('leveling', core)) continue;
        const settings = await bot.settings.module(guild.id, levelingSettings);
        if (!settings.voice.enabled || settings.voice.perMinute <= 0) continue;

        const states = [...guild.voiceStates.cache.values()].filter((s) => s.channelId && s.member);
        const eligible = eligibleVoiceMembers(
          states.map((s) => ({ userId: s.id, channelId: s.channelId!, bot: Boolean(s.member?.user.bot), deaf: Boolean(s.deaf) })),
          guild.afkChannelId,
          settings.voice.requireOthers,
        );
        for (const userId of eligible) {
          const state = guild.voiceStates.cache.get(userId)!;
          const member = state.member!;
          if (isIgnored(member, state.channelId, state.channel?.parentId ?? null, settings)) continue;
          const amount = Math.round(settings.voice.perMinute * (tickSeconds / 60) * multiplierFor(member, settings));
          await grantXp(bot, member, amount, 'voice', null).catch((err) => bot.logger.warn({ err }, 'voice xp failed'));
        }
      }
    } catch (err) {
      bot.logger.error({ err }, 'voice xp tick failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), tickSeconds * 1000);
  return () => clearInterval(timer);
}
