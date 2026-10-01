import { ButtonBuilder, ButtonStyle, userMention } from 'discord.js';
import type { Player, Track, UnresolvedTrack } from 'lavalink-client';
import type { Bot } from '../../core/bot.js';
import type { Panel } from '../../core/ui/panel.js';
import { activeFilters } from './filters.js';
import { cleanTitle, formatTime, progressBar } from './format.js';

type T = (key: string, vars?: Record<string, string | number>) => string;

export interface Requester {
  id: string;
  username: string;
}

export function requesterOf(track: Track | UnresolvedTrack | null | undefined): Requester | null {
  const r = track?.requester as Partial<Requester> | undefined;
  return r?.id ? { id: r.id, username: r.username ?? '' } : null;
}

export function trackLink(track: Track | UnresolvedTrack): string {
  const title = cleanTitle(track.info.title ?? 'Unknown');
  return track.info.uri ? `[${title}](${track.info.uri})` : `**${title}**`;
}

export function nowPlayingPanel(bot: Bot, player: Player, t: T, color: number): Panel {
  const track = player.queue.current;
  const panel = bot.panel(color).title(t('music.nowPlaying.title'));
  if (!track) return panel.text(t('music.nowPlaying.nothing'));

  const live = track.info.isStream;
  const time = live ? t('music.nowPlaying.live') : `${formatTime(player.position)} ${progressBar(player.position, track.info.duration)} ${formatTime(track.info.duration)}`;
  const requester = requesterOf(track);
  const filters = activeFilters(player);

  panel
    .thumbnail(track.info.artworkUrl)
    .text(`${trackLink(track)}\n${cleanTitle(track.info.author ?? '', 60)}`, `\`${time}\``)
    .fields([
      { name: t('music.nowPlaying.requestedBy'), value: requester ? userMention(requester.id) : '-', inline: true },
      { name: t('music.nowPlaying.volume'), value: `${player.volume}%`, inline: true },
      { name: t('music.nowPlaying.loop'), value: t(`music.loop.modes.${player.repeatMode}`), inline: true },
      { name: t('music.nowPlaying.upNext'), value: player.queue.tracks[0] ? trackLink(player.queue.tracks[0]) : '-', inline: false },
    ]);
  if (filters.length > 0 || player.queue.tracks.length > 0) {
    panel.footer(
      [
        player.queue.tracks.length > 0 ? t('music.nowPlaying.queued', { count: player.queue.tracks.length }) : null,
        filters.length > 0 ? t('music.nowPlaying.filters', { filters: filters.join(', ') }) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }

  const button = (action: string, label: string, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(`music:ctl:${action}`).setStyle(style).setLabel(label);
  return panel
    .row(
      button('previous', t('music.controls.previous')).setDisabled(player.queue.previous.length === 0),
      button(player.paused ? 'resume' : 'pause', t(player.paused ? 'music.controls.resume' : 'music.controls.pause'), ButtonStyle.Primary),
      button('skip', t('music.controls.skip'), ButtonStyle.Primary),
      button('stop', t('music.controls.stop'), ButtonStyle.Danger),
    )
    .row(
      button('loop', t('music.controls.loop')),
      button('shuffle', t('music.controls.shuffle')).setDisabled(player.queue.tracks.length < 2),
      button('voldown', t('music.controls.volumeDown')),
      button('volup', t('music.controls.volumeUp')),
      button('queue', t('music.controls.queue')),
    );
}
