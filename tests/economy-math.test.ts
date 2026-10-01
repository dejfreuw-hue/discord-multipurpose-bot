import { describe, expect, it } from 'vitest';
import {
  coinflipWins,
  dailyReward,
  nextStreak,
  parseAmount,
  payout,
  randomInt,
  robOutcome,
  slotsMultiplier,
  slotsReturnRate,
  spin,
  type SlotSymbol,
} from '../src/modules/economy/math.js';
import { economyConfig, formatMoney } from '../src/modules/economy/settings.js';

const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe('parseAmount', () => {
  it('reads plain numbers and separators', () => {
    expect(parseAmount('500', 0)).toBe(500);
    expect(parseAmount('1,500', 0)).toBe(1500);
    expect(parseAmount(' 2 000 ', 0)).toBe(2000);
  });

  it('reads k, m and b suffixes', () => {
    expect(parseAmount('2.5k', 0)).toBe(2500);
    expect(parseAmount('1M', 0)).toBe(1_000_000);
    expect(parseAmount('3b', 0)).toBe(3_000_000_000);
  });

  it('reads relative amounts from what is available', () => {
    expect(parseAmount('all', 1234)).toBe(1234);
    expect(parseAmount('half', 1235)).toBe(617);
    expect(parseAmount('25%', 1000)).toBe(250);
  });

  it('rejects junk, zero and negatives', () => {
    for (const bad of ['', 'abc', '-5', '0', '0.4', 'all', '1e9', '5kk', '10%%']) {
      expect(parseAmount(bad, 0)).toBeNull();
    }
    expect(parseAmount('99999999999999999999', 0)).toBeNull();
  });
});

describe('daily rewards', () => {
  const day = 86_400_000;
  const now = new Date('2026-05-10T12:00:00Z');

  it('continues a streak within two days and resets after', () => {
    expect(nextStreak(null, 0, now)).toBe(1);
    expect(nextStreak(new Date(now.getTime() - day), 4, now)).toBe(5);
    expect(nextStreak(new Date(now.getTime() - 1.9 * day), 4, now)).toBe(5);
    expect(nextStreak(new Date(now.getTime() - 3 * day), 4, now)).toBe(1);
  });

  it('adds a bonus per streak day up to the cap', () => {
    expect(dailyReward(500, 50, 1, 10)).toBe(500);
    expect(dailyReward(500, 50, 3, 10)).toBe(600);
    expect(dailyReward(500, 50, 40, 10)).toBe(950);
  });
});

describe('robOutcome', () => {
  const rules = { successChance: 40, minPercent: 10, maxPercent: 30, finePercent: 15 };

  it('steals a share of the target wallet on success', () => {
    expect(robOutcome(rules, 1000, 500, sequence(0.1, 0))).toEqual({ success: true, amount: 100 });
    expect(robOutcome(rules, 1000, 500, sequence(0.1, 0.999))).toEqual({ success: true, amount: 300 });
  });

  it('fines the robber on failure, never more than they have', () => {
    expect(robOutcome(rules, 1000, 500, sequence(0.9))).toEqual({ success: false, fine: 75 });
    expect(robOutcome({ ...rules, finePercent: 100 }, 1000, 40, sequence(0.9))).toEqual({ success: false, fine: 40 });
  });

  it('respects the success chance over many tries', () => {
    let wins = 0;
    for (let i = 0; i < 10_000; i++) if (robOutcome(rules, 100, 100).success) wins++;
    expect(wins / 10_000).toBeGreaterThan(0.37);
    expect(wins / 10_000).toBeLessThan(0.43);
  });
});

describe('coinflip and payouts', () => {
  it('wins below the configured chance', () => {
    expect(coinflipWins(50, () => 0.49)).toBe(true);
    expect(coinflipWins(50, () => 0.5)).toBe(false);
    expect(coinflipWins(0, () => 0)).toBe(false);
  });

  it('rounds payouts down', () => {
    expect(payout(101, 1.5)).toBe(151);
    expect(payout(3, 0.75)).toBe(2);
  });

  it('keeps random integers inside the range', () => {
    expect(randomInt(100, 400, () => 0)).toBe(100);
    expect(randomInt(100, 400, () => 0.99999)).toBe(400);
    expect(randomInt(400, 100, () => 0)).toBe(100);
  });
});

describe('slots', () => {
  const symbols: SlotSymbol[] = [
    { id: 'a', weight: 1, three: 10, two: 1 },
    { id: 'b', weight: 1, three: 20, two: 2 },
  ];

  it('pays three of a kind, then pairs in any position', () => {
    const [a, b] = symbols as [SlotSymbol, SlotSymbol];
    expect(slotsMultiplier([a, a, a])).toBe(10);
    expect(slotsMultiplier([b, a, b])).toBe(2);
    expect(slotsMultiplier([a, b, b])).toBe(2);
    expect(slotsMultiplier([a, a, b])).toBe(1);
  });

  it('picks symbols by weight', () => {
    expect(spin(symbols, () => 0).map((s) => s.id)).toEqual(['a', 'a', 'a']);
    expect(spin(symbols, () => 0.99).map((s) => s.id)).toEqual(['b', 'b', 'b']);
  });

  it('computes the exact return rate', () => {
    // 2 symbols, 8 equally likely outcomes: 1 aaa, 1 bbb, 3 with a pair of a, 3 with a pair of b.
    expect(slotsReturnRate(symbols)).toBeCloseTo((10 + 20 + 3 * 1 + 3 * 2) / 8);
  });

  it('ships defaults that favour the house a little', () => {
    const rate = slotsReturnRate(economyConfig.parse({}).slots);
    expect(rate).toBeGreaterThan(0.9);
    expect(rate).toBeLessThan(0.97);
  });

  it('matches the computed rate in a simulation', () => {
    const defaults = economyConfig.parse({}).slots;
    let returned = 0;
    const spins = 200_000;
    for (let i = 0; i < spins; i++) returned += slotsMultiplier(spin(defaults));
    expect(returned / spins).toBeCloseTo(slotsReturnRate(defaults), 1);
  });
});

describe('formatMoney', () => {
  it('uses the symbol when set, else the name', () => {
    expect(formatMoney(1234.9, { name: 'coins', symbol: '' })).toBe('1,234 coins');
    expect(formatMoney(5, { name: 'dollars', symbol: '$' })).toBe('$5');
  });
});
