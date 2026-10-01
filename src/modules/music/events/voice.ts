import { Events } from 'discord.js';
import { defineEvent } from '../../../core/module.js';
import { clearIdle, playerFor, scheduleLeave } from '../lavalink.js';
import { musicConfig, musicSettings } from '../settings.js';

// Leaves when everyone else has left the voice channel, and stays if someone comes back in time.
export default defineEvent({
  name: Events.VoiceStateUpdate,
  async run(bot, oldState, newState) {
    const guild = newState.guild;
    const player = playerFor(guild.id);
    if (!player?.voiceChannelId) return;
    if (oldState.channelId !== player.voiceChannelId && newState.channelId !== player.voiceChannelId) return;

    const channel = guild.channels.cache.get(player.voiceChannelId);
    if (!channel?.isVoiceBased()) return;
    const listeners = channel.members.filter((m) => !m.user.bot).size;
    if (listeners > 0) {
      // Only cancel the "alone" timer; an empty queue still leaves on its own schedule.
      if (player.queue.current) clearIdle(guild.id);
      return;
    }
    if ((await bot.settings.module(guild.id, musicSettings)).alwaysOn) return;
    scheduleLeave(bot, guild.id, bot.moduleConfig({ name: 'music', config: musicConfig }).emptyChannelSeconds, 'channel empty');
  },
});
