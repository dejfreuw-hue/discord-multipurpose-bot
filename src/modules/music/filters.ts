import type { Player } from 'lavalink-client';

export const FILTERS = ['bassboost', 'nightcore', 'vaporwave', '8d', 'karaoke'] as const;
export type FilterName = (typeof FILTERS)[number];

/** Which of our named filters are active on a player. */
export function activeFilters(player: Player): FilterName[] {
  const f = player.filterManager.filters;
  const active: FilterName[] = [];
  if (player.filterManager.equalizerBands.length > 0) active.push('bassboost');
  if (f.nightcore) active.push('nightcore');
  if (f.vaporwave) active.push('vaporwave');
  if (f.rotation) active.push('8d');
  if (f.karaoke) active.push('karaoke');
  return active;
}

/** Turns a filter on or off. Nightcore and vaporwave replace each other, as in lavalink-client. */
export async function toggleFilter(player: Player, name: FilterName): Promise<boolean> {
  const fm = player.filterManager;
  switch (name) {
    case 'bassboost':
      if (fm.equalizerBands.length > 0) await fm.clearEQ();
      else await fm.setEQPreset('BassboostMedium');
      break;
    case 'nightcore':
      await fm.toggleNightcore();
      break;
    case 'vaporwave':
      await fm.toggleVaporwave();
      break;
    case '8d':
      // 0.2 Hz is the usual "8D audio" rotation speed: slow enough to follow, fast enough to notice.
      await fm.toggleRotation(0.2);
      break;
    case 'karaoke':
      await fm.toggleKaraoke();
      break;
  }
  return activeFilters(player).includes(name);
}

export async function applyFilters(player: Player, names: readonly string[]): Promise<void> {
  for (const name of names) {
    if ((FILTERS as readonly string[]).includes(name) && !activeFilters(player).includes(name as FilterName)) {
      await toggleFilter(player, name as FilterName);
    }
  }
}
