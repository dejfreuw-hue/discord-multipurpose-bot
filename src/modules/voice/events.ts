import { Events } from 'discord.js';
import { defineEvent } from '../../core/module.js';
import { createFor, removeChannel, tempChannel } from './channels.js';
import { TempChannelModel } from './model.js';
import { voiceConfig, voiceSettings } from './settings.js';

export const voiceStateUpdate = defineEvent({
  name: Events.VoiceStateUpdate,
  async run(bot, oldState, newState) {
    if (oldState.channelId === newState.channelId) return;
    const guild = newState.guild;
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;
    const core = await bot.settings.get(guild.id);
    if (!bot.isEnabled('voice', core)) return;

    // One update can be both a leave and a join (moving between channels), so handle both.
    if (oldState.channelId && oldState.channel) {
      const doc = await tempChannel(oldState.channelId);
      if (doc && oldState.channel.members.filter((m) => !m.user.bot).size === 0) {
        await removeChannel(guild, oldState.channelId);
      }
    }

    if (newState.channelId) {
      const { hubs } = await bot.settings.module(guild.id, voiceSettings);
      const hub = hubs.find((h) => h.channelId === newState.channelId);
      if (hub) await createFor(bot, member, hub, bot.moduleConfig({ name: 'voice', config: voiceConfig }).createCooldownSeconds);
    }
  },
});

export const channelDelete = defineEvent({
  name: Events.ChannelDelete,
  async run(bot, channel) {
    if (channel.isDMBased()) return;
    await TempChannelModel.deleteOne({ channelId: channel.id });
    const settings = await bot.settings.module(channel.guild.id, voiceSettings);
    if (settings.hubs.some((h) => h.channelId === channel.id)) {
      await bot.settings.updateModule(channel.guild.id, voiceSettings, { hubs: settings.hubs.filter((h) => h.channelId !== channel.id) });
    }
  },
});
