import { describe, expect, it } from 'vitest';
import { entriesFor, pickWinners } from '../src/modules/community/giveaways/draw.js';

describe('pickWinners', () => {
  it('never picks the same member twice', () => {
    const entrants = [
      { id: 'a', weight: 100 },
      { id: 'b', weight: 1 },
      { id: 'c', weight: 1 },
    ];
    for (let i = 0; i < 100; i++) {
      const winners = pickWinners(entrants, 3);
      expect(new Set(winners).size).toBe(3);
    }
  });

  it('returns fewer winners when there are fewer eligible entrants', () => {
    expect(pickWinners([{ id: 'a', weight: 1 }, { id: 'b', weight: 0 }], 5)).toEqual(['a']);
    expect(pickWinners([], 3)).toEqual([]);
  });

  it('weights the odds by entries', () => {
    const wins = { a: 0, b: 0 };
    for (let i = 0; i < 20_000; i++) {
      const [winner] = pickWinners([{ id: 'a', weight: 3 }, { id: 'b', weight: 1 }], 1) as ['a' | 'b'];
      wins[winner]++;
    }
    expect(wins.a / 20_000).toBeGreaterThan(0.72);
    expect(wins.a / 20_000).toBeLessThan(0.78);
  });

  it('is deterministic with a fixed random source', () => {
    const entrants = [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 1 },
    ];
    expect(pickWinners(entrants, 1, () => 0)).toEqual(['a']);
    expect(pickWinners(entrants, 1, () => 0.99)).toEqual(['b']);
  });
});

describe('entriesFor', () => {
  const rules = { boosterEntries: 2, bonusRoles: [{ roleId: 'vip', entries: 3 }, { roleId: 'og', entries: 1 }] };

  it('adds booster and bonus role entries on top of the base entry', () => {
    expect(entriesFor({ boosting: false, roles: new Set() }, rules)).toBe(1);
    expect(entriesFor({ boosting: true, roles: new Set() }, rules)).toBe(3);
    expect(entriesFor({ boosting: true, roles: new Set(['vip', 'og']) }, rules)).toBe(7);
  });
});
