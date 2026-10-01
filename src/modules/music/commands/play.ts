import { SlashCommandBuilder, type AutocompleteInteraction } from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand } from '../../../core/module.js';
import { assertCanJoin, memberChannel } from '../control.js';
import { cleanTitle, formatTime } from '../format.js';
import { clearIdle, lavalink, saveSession } from '../lavalink.js';
import { trackLink } from '../nowplaying.js';
import { musicConfig, musicSettings } from '../settings.js';

const URL = /^https?:\/\//i;
const AUTOCOMPLETE_TIMEOUT_MS = 2500;

async function suggestions(interaction: AutocompleteInteraction, bot: Bot): Promise<void> {
  const typed = interaction.options.getFocused().trim();
  if (typed.length < 3 || URL.test(typed)) return interaction.respond([]);
  const node = lavalink().nodeManager.leastUsedNodes()[0];
  if (!node) return interaction.respond([]);

  const source = bot.moduleConfig({ name: 'music', config: musicConfig }).defaultSearch;
  // Autocomplete must answer within 3 seconds, so a slow search just shows nothing.
  const result = await Promise.race([
    node.search({ query: typed, source }, interaction.user),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), AUTOCOMPLETE_TIMEOUT_MS)),
  ]);
  const choices = (result?.tracks ?? []).slice(0, 10).map((t) => {
    const name = `${t.info.title} - ${t.info.author}`.slice(0, 95);
    // Choice values max out at 100 characters; long URLs fall back to searching by title.
    const value = t.info.uri && t.info.uri.length <= 100 ? t.info.uri : t.info.title.slice(0, 100);
    return { name, value };
  });
  await interaction.respond(choices);
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('music.play.description')
    .addStringOption((o) => o.setName('query').setDescription('music.play.options.query').setRequired(true).setAutocomplete(true).setMaxLength(500))
    .addBooleanOption((o) => o.setName('next').setDescription('music.play.options.next')),
  cooldown: 2,
  autocomplete: suggestions,
  async run(ctx) {
    const channel = memberChannel(ctx);
    assertCanJoin(channel);
    const manager = lavalink();
    const config = ctx.bot.moduleConfig({ name: 'music', config: musicConfig });
    const settings = await ctx.bot.settings.module(ctx.guild.id, musicSettings);

    const player =
      manager.getPlayer(ctx.guild.id) ??
      manager.createPlayer({
        guildId: ctx.guild.id,
        voiceChannelId: channel.id,
        textChannelId: ctx.interaction.channelId,
        volume: settings.defaultVolume,
        selfDeaf: true,
      });
    if (!player.connected) await player.connect();

    const query = ctx.interaction.options.getString('query', true).trim();
    const result = await player.search(URL.test(query) ? { query } : { query, source: config.defaultSearch }, ctx.interaction.user);
    if (result.loadType === 'error') {
      ctx.bot.logger.info({ query, error: result.exception?.message }, 'lavalink search failed');
      throw new UserError('music.errors.loadFailed');
    }
    if (result.loadType === 'empty' || result.tracks.length === 0) throw new UserError('music.errors.noResults', { query: cleanTitle(query, 60) });

    const room = config.maxQueue - player.queue.tracks.length;
    if (room <= 0) throw new UserError('music.errors.queueFull', { max: config.maxQueue });
    const next = ctx.interaction.options.getBoolean('next') ?? false;
    const tracks = result.loadType === 'playlist' ? result.tracks.slice(0, room) : [result.tracks[0]!];
    const wasIdle = !player.queue.current;
    await player.queue.add(tracks, next ? 0 : undefined);

    clearIdle(ctx.guild.id);
    if (!player.playing && !player.paused) await player.play({ paused: false });
    await saveSession(player);

    if (result.loadType === 'playlist') {
      const skipped = result.tracks.length - tracks.length;
      await ctx.respond(
        ctx.successPanel(
          ctx.t('music.play.playlist', { count: tracks.length, name: cleanTitle(result.playlist?.name ?? '', 60) }) +
            (skipped > 0 ? `\n-# ${ctx.t('music.play.truncated', { count: skipped })}` : ''),
        ),
      );
      return;
    }
    const track = tracks[0]!;
    const text = wasIdle
      ? ctx.t('music.play.playing', { track: trackLink(track) })
      : ctx.t('music.play.queued', {
          track: trackLink(track),
          position: next ? 1 : player.queue.tracks.length,
          duration: track.info.isStream ? ctx.t('music.nowPlaying.live') : formatTime(track.info.duration ?? 0),
        });
    await ctx.respond(ctx.successPanel(text).thumbnail(track.info.artworkUrl ?? null));
  },
});
