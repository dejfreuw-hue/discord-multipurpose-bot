import { SlashCommandBuilder } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand } from '../../../core/module.js';
import { changeVolume, cycleLoop, pause, previous, resume, skip, stop } from '../actions.js';
import { activePlayer, assertCanJoin, assertControl, memberChannel } from '../control.js';
import { FILTERS, toggleFilter, type FilterName } from '../filters.js';
import { formatTime, parseTimestamp } from '../format.js';
import { endSession, lavalink, saveSession, scheduleLeave } from '../lavalink.js';
import { musicConfig, musicSettings } from '../settings.js';

export const skipCommand = defineCommand({
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('music.skip.description')
    .addIntegerOption((o) => o.setName('to').setDescription('music.skip.options.to').setMinValue(1)),
  async run(ctx) {
    const player = activePlayer(ctx);
    await assertControl(ctx, player);
    await skip(player, ctx.interaction.options.getInteger('to') ?? 0);
    await ctx.respond(ctx.successPanel(ctx.t('music.skip.done')));
  },
});

export const previousCommand = defineCommand({
  data: new SlashCommandBuilder().setName('previous').setDescription('music.previous.description'),
  async run(ctx) {
    const player = activePlayer(ctx);
    await assertControl(ctx, player);
    await previous(player);
    await ctx.respond(ctx.successPanel(ctx.t('music.previous.done')));
  },
});

export const stopCommand = defineCommand({
  data: new SlashCommandBuilder().setName('stop').setDescription('music.stop.description'),
  async run(ctx) {
    const player = activePlayer(ctx);
    await assertControl(ctx, player);
    await stop(player);
    await ctx.respond(ctx.successPanel(ctx.t('music.stop.done')));
  },
});

export const pauseCommand = defineCommand({
  data: new SlashCommandBuilder().setName('pause').setDescription('music.pause.description'),
  async run(ctx) {
    const player = activePlayer(ctx);
    await assertControl(ctx, player);
    await pause(player);
    await ctx.respond(ctx.successPanel(ctx.t('music.pause.done')));
  },
});

export const resumeCommand = defineCommand({
  data: new SlashCommandBuilder().setName('resume').setDescription('music.resume.description'),
  async run(ctx) {
    const player = activePlayer(ctx);
    await assertControl(ctx, player);
    await resume(player);
    await ctx.respond(ctx.successPanel(ctx.t('music.resume.done')));
  },
});

export const seekCommand = defineCommand({
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('music.seek.description')
    .addStringOption((o) => o.setName('time').setDescription('music.seek.options.time').setRequired(true).setMaxLength(12)),
  async run(ctx) {
    const player = activePlayer(ctx);
    await assertControl(ctx, player);
    const track = player.queue.current;
    if (!track) throw new UserError('music.errors.nothingPlaying');
    if (!track.info.isSeekable || track.info.isStream) throw new UserError('music.errors.notSeekable');
    const raw = ctx.interaction.options.getString('time', true);
    const ms = parseTimestamp(raw);
    if (ms === null || ms > track.info.duration) throw new UserError('music.errors.badTime', { value: raw, duration: formatTime(track.info.duration) });
    await player.seek(ms);
    await saveSession(player);
    await ctx.respond(ctx.successPanel(ctx.t('music.seek.done', { time: formatTime(ms) })));
  },
});

export const volumeCommand = defineCommand({
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('music.volume.description')
    .addIntegerOption((o) => o.setName('percent').setDescription('music.volume.options.percent').setRequired(true).setMinValue(0).setMaxValue(150)),
  async run(ctx) {
    const player = activePlayer(ctx);
    await assertControl(ctx, player);
    const volume = await changeVolume(player, ctx.interaction.options.getInteger('percent', true));
    await ctx.respond(ctx.successPanel(ctx.t('music.volume.done', { volume })));
  },
});

export const loopCommand = defineCommand({
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('music.loop.description')
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('music.loop.options.mode')
        .addChoices(
          { name: 'music.loop.modes.off', value: 'off' },
          { name: 'music.loop.modes.track', value: 'track' },
          { name: 'music.loop.modes.queue', value: 'queue' },
        ),
    ),
  async run(ctx) {
    const player = activePlayer(ctx);
    await assertControl(ctx, player);
    const mode = ctx.interaction.options.getString('mode') as 'off' | 'track' | 'queue' | null;
    let result = mode;
    if (mode) {
      await player.setRepeatMode(mode);
      await saveSession(player);
    } else {
      result = await cycleLoop(player);
    }
    await ctx.respond(ctx.successPanel(ctx.t('music.loop.done', { mode: ctx.t(`music.loop.modes.${result}`) })));
  },
});

export const filterCommand = defineCommand({
  data: new SlashCommandBuilder()
    .setName('filter')
    .setDescription('music.filter.description')
    .addStringOption((o) =>
      o
        .setName('name')
        .setDescription('music.filter.options.name')
        .setRequired(true)
        .addChoices(...[...FILTERS, 'off'].map((f) => ({ name: `music.filter.names.${f}`, value: f }))),
    ),
  async run(ctx) {
    const player = activePlayer(ctx);
    await assertControl(ctx, player);
    const name = ctx.interaction.options.getString('name', true);
    if (name === 'off') {
      await player.filterManager.resetFilters();
      await saveSession(player);
      await ctx.respond(ctx.successPanel(ctx.t('music.filter.cleared')));
      return;
    }
    const on = await toggleFilter(player, name as FilterName);
    await saveSession(player);
    await ctx.respond(ctx.successPanel(ctx.t(on ? 'music.filter.on' : 'music.filter.off', { filter: ctx.t(`music.filter.names.${name}`) })));
  },
});

export const leaveCommand = defineCommand({
  data: new SlashCommandBuilder().setName('leave').setDescription('music.leave.description'),
  async run(ctx) {
    const player = activePlayer(ctx);
    await assertControl(ctx, player);
    await endSession(ctx.guild.id, 'left by command');
    await ctx.respond(ctx.successPanel(ctx.t('music.leave.done')));
  },
});

export const alwaysOnCommand = defineCommand({
  data: new SlashCommandBuilder()
    .setName('247')
    .setDescription('music.alwaysOn.description')
    .addBooleanOption((o) => o.setName('enabled').setDescription('music.alwaysOn.options.enabled').setRequired(true)),
  permissions: { user: 'ManageGuild', allowStaff: true },
  async run(ctx) {
    const enabled = ctx.interaction.options.getBoolean('enabled', true);
    await ctx.bot.settings.updateModule(ctx.guild.id, musicSettings, { alwaysOn: enabled });

    const manager = lavalink();
    let player = manager.getPlayer(ctx.guild.id);
    if (enabled && !player) {
      // Turning 24/7 on joins the member's channel right away so the bot has somewhere to stay.
      const channel = memberChannel(ctx);
      assertCanJoin(channel);
      player = manager.createPlayer({ guildId: ctx.guild.id, voiceChannelId: channel.id, textChannelId: ctx.interaction.channelId, selfDeaf: true });
      await player.connect();
    }
    if (player) {
      await saveSession(player);
      if (!enabled && !player.queue.current) {
        scheduleLeave(ctx.bot, ctx.guild.id, ctx.bot.moduleConfig({ name: 'music', config: musicConfig }).idleSeconds, 'queue empty');
      }
    }
    await ctx.respond(ctx.successPanel(ctx.t(enabled ? 'music.alwaysOn.on' : 'music.alwaysOn.off')));
  },
});
