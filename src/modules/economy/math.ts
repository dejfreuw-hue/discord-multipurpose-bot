/*
 * Economy rules as plain functions: no database, no Discord. Every random choice takes an
 * injectable `random` so tests can pin outcomes.
 */

export type Random = () => number;

const SUFFIXES: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };

/**
 * Parses amounts people type: "500", "1,500", "2.5k", "1m", "all", "half" or "25%".
 * Relative amounts are taken from `available`. Returns null for anything else or below 1.
 */
export function parseAmount(input: string, available: number): number | null {
  const text = input.trim().toLowerCase().replace(/[,_\s]/g, '');
  let value: number;
  if (text === 'all' || text === 'max') value = available;
  else if (text === 'half') value = available / 2;
  else if (/^\d+(\.\d+)?%$/.test(text)) value = (available * Number(text.slice(0, -1))) / 100;
  else {
    const match = /^(\d+(?:\.\d+)?)([kmb])?$/.exec(text);
    if (!match) return null;
    value = Number(match[1]) * (match[2] ? SUFFIXES[match[2]]! : 1);
  }
  const whole = Math.floor(value);
  return Number.isSafeInteger(whole) && whole >= 1 ? whole : null;
}

export function randomInt(min: number, max: number, random: Random = Math.random): number {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return low + Math.floor(random() * (high - low + 1));
}

/**
 * The streak after claiming a daily reward. Claiming within two days of the last claim keeps
 * the streak going; waiting longer starts over at 1.
 */
export function nextStreak(lastClaim: Date | null, streak: number, now: Date, windowMs = 48 * 3_600_000): number {
  if (!lastClaim || now.getTime() - lastClaim.getTime() > windowMs) return 1;
  return streak + 1;
}

export function dailyReward(base: number, bonusPerDay: number, streak: number, maxStreak: number): number {
  return base + bonusPerDay * (Math.min(Math.max(streak, 1), maxStreak) - 1);
}

export interface RobRules {
  successChance: number;
  minPercent: number;
  maxPercent: number;
  finePercent: number;
}

export type RobOutcome = { success: true; amount: number } | { success: false; fine: number };

/** Decides a robbery: on success a share of the target's wallet, on failure a fine from the robber's. */
export function robOutcome(rules: RobRules, targetWallet: number, robberWallet: number, random: Random = Math.random): RobOutcome {
  if (random() * 100 < rules.successChance) {
    const percent = randomInt(rules.minPercent, rules.maxPercent, random);
    return { success: true, amount: Math.max(1, Math.floor((targetWallet * percent) / 100)) };
  }
  return { success: false, fine: Math.min(robberWallet, Math.floor((robberWallet * rules.finePercent) / 100)) };
}

/** Coinflip: whether the call wins. `winChance` is a percentage, so the house edge is configurable. */
export function coinflipWins(winChance: number, random: Random = Math.random): boolean {
  return random() * 100 < winChance;
}

export interface SlotSymbol {
  id: string;
  weight: number;
  /** Multiplier of the bet for three matching symbols. */
  three: number;
  /** Multiplier of the bet for exactly two matching symbols. */
  two: number;
}

export function spin(symbols: readonly SlotSymbol[], random: Random = Math.random): SlotSymbol[] {
  const total = symbols.reduce((sum, s) => sum + s.weight, 0);
  const pick = () => {
    let roll = random() * total;
    for (const s of symbols) {
      roll -= s.weight;
      if (roll < 0) return s;
    }
    return symbols.at(-1)!;
  };
  return [pick(), pick(), pick()];
}

/** The payout multiplier for a spin: three of a kind, else a pair, else nothing. */
export function slotsMultiplier(reels: readonly SlotSymbol[]): number {
  const [a, b, c] = reels;
  if (!a || !b || !c) return 0;
  if (a.id === b.id && b.id === c.id) return a.three;
  if (a.id === b.id || a.id === c.id) return a.two;
  if (b.id === c.id) return b.two;
  return 0;
}

/**
 * Expected return per unit bet (0.95 means the house keeps 5% over time). Exact, computed over
 * every combination, so config.yml changes can be checked before going live.
 */
export function slotsReturnRate(symbols: readonly SlotSymbol[]): number {
  const total = symbols.reduce((sum, s) => sum + s.weight, 0);
  let expected = 0;
  for (const a of symbols) {
    for (const b of symbols) {
      for (const c of symbols) {
        const p = (a.weight / total) * (b.weight / total) * (c.weight / total);
        expected += p * slotsMultiplier([a, b, c]);
      }
    }
  }
  return expected;
}

/** Money gained back for a bet: the stake times the multiplier, rounded down. */
export function payout(bet: number, multiplier: number): number {
  return Math.floor(bet * multiplier);
}
