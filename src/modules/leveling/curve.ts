/**
 * XP needed to go from `level` to `level + 1` is a*level^2 + b*level + c. The defaults
 * (5, 50, 100) give the curve most Discord leveling bots use: 100 XP for level 1, 1,150
 * to reach level 5 and 23,850 for level 20.
 */
export interface Curve {
  quadratic: number;
  linear: number;
  base: number;
}

export const DEFAULT_CURVE: Curve = { quadratic: 5, linear: 50, base: 100 };

/** Hard ceiling so a typo in config.yml can't send the level loop into the millions. */
export const MAX_LEVEL = 1000;

export function xpForNextLevel(level: number, curve: Curve = DEFAULT_CURVE): number {
  return Math.round(curve.quadratic * level ** 2 + curve.linear * level + curve.base);
}

/** Total XP a member needs from zero to reach `level`. */
export function totalXpForLevel(level: number, curve: Curve = DEFAULT_CURVE): number {
  let total = 0;
  for (let l = 0; l < Math.min(level, MAX_LEVEL); l++) total += xpForNextLevel(l, curve);
  return total;
}

export interface Progress {
  level: number;
  /** XP earned inside the current level. */
  current: number;
  /** XP the current level takes in total. */
  needed: number;
}

export function progressFor(totalXp: number, curve: Curve = DEFAULT_CURVE): Progress {
  let level = 0;
  let rest = Math.max(0, Math.floor(totalXp));
  while (level < MAX_LEVEL) {
    const needed = xpForNextLevel(level, curve);
    if (rest < needed) return { level, current: rest, needed };
    rest -= needed;
    level++;
  }
  return { level: MAX_LEVEL, current: 0, needed: xpForNextLevel(MAX_LEVEL, curve) };
}

/** Random XP for one message, scaled by the member's best multiplier. */
export function messageXp(min: number, max: number, multiplier = 1, random: () => number = Math.random): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.round((low + Math.floor(random() * (high - low + 1))) * multiplier);
}

/** Roles a member should hold for their level: every reached reward when stacking, else only the highest. */
export function rewardRoles(rewards: readonly { level: number; roleId: string }[], level: number, stack: boolean): string[] {
  const reached = rewards.filter((r) => r.level <= level).sort((a, b) => a.level - b.level);
  if (stack) return reached.map((r) => r.roleId);
  const top = reached.at(-1);
  return top ? [top.roleId] : [];
}
