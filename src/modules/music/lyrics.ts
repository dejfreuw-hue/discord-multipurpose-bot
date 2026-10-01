import type { Player, Track } from 'lavalink-client';

const LRCLIB = 'https://lrclib.net/api';

interface LrclibEntry {
  trackName: string;
  artistName: string;
  plainLyrics: string | null;
  instrumental: boolean;
}

export interface Lyrics {
  title: string;
  artist: string;
  text: string;
  source: string;
}

/** Removes the noise YouTube titles carry, which otherwise ruins lyric lookups. */
export function searchableTitle(title: string): string {
  return title
    .replace(/\s*[([](official|lyric|lyrics|audio|video|music video|hd|hq|4k|visualizer|live)[^)\]]*[)\]]/gi, '')
    .replace(/\s*\|.*$/, '')
    .replace(/\s+-\s+topic$/i, '')
    .trim();
}

async function lrclib(params: Record<string, string>): Promise<LrclibEntry[]> {
  const url = `${LRCLIB}/search?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'reuw-bot (Discord bot; https://lrclib.net)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  return (await res.json()) as LrclibEntry[];
}

/** Looks lyrics up on LRCLIB, a free public database. No API key needed. */
export async function findLyrics(query: { title: string; artist?: string } | string): Promise<Lyrics | null> {
  const params: Record<string, string> = typeof query === 'string' ? { q: query } : { track_name: searchableTitle(query.title) };
  if (typeof query !== 'string' && query.artist) params.artist_name = query.artist;
  let results = await lrclib(params).catch(() => []);
  // Artist names from YouTube are often channel names, so retry with the title alone.
  if (results.length === 0 && typeof query !== 'string') results = await lrclib({ q: searchableTitle(query.title) }).catch(() => []);
  const hit = results.find((r) => r.plainLyrics && !r.instrumental);
  return hit ? { title: hit.trackName, artist: hit.artistName, text: hit.plainLyrics!, source: 'LRCLIB' } : null;
}

/** Lyrics for the current track: the Lavalink lyrics plugin when installed, LRCLIB otherwise. */
export async function currentLyrics(player: Player, track: Track): Promise<Lyrics | null> {
  const fromPlugin = await player.getCurrentLyrics().catch(() => null);
  if (fromPlugin?.text || fromPlugin?.lines.length) {
    const text = fromPlugin.text ?? fromPlugin.lines.map((l) => l.line).join('\n');
    return { title: track.info.title, artist: track.info.author, text, source: fromPlugin.provider || fromPlugin.sourceName };
  }
  return findLyrics({ title: track.info.title, artist: track.info.author.replace(/\s+-\s+topic$/i, '') });
}
