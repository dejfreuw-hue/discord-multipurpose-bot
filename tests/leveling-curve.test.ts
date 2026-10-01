import { describe, expect, it } from 'vitest';
import { messageXp, progressFor, rewardRoles, totalXpForLevel, xpForNextLevel } from '../src/modules/leveling/curve.js';

describe('XP curve', () => {
  it('matches the familiar defaults', () => {
    expect(xpForNextLevel(0)).toBe(100);
    expect(xpForNextLevel(1)).toBe(155);
    expect(xpForNextLevel(10)).toBe(1100);
    expect(totalXpForLevel(1)).toBe(100);
    expect(totalXpForLevel(5)).toBe(1_150);
  });

  it('grows faster at higher levels', () => {
    for (let l = 1; l < 100; l++) expect(xpForNextLevel(l)).toBeGreaterThan(xpForNextLevel(l - 1));
  });

  it('turns total XP into level and progress', () => {
    expect(progressFor(0)).toEqual({ level: 0, current: 0, needed: 100 });
    expect(progressFor(99)).toEqual({ level: 0, current: 99, needed: 100 });
    expect(progressFor(100)).toEqual({ level: 1, current: 0, needed: 155 });
    expect(progressFor(totalXpForLevel(20) + 7)).toEqual({ level: 20, current: 7, needed: xpForNextLevel(20) });
  });

  it('is consistent: reaching a level exactly needs its total', () => {
    for (const level of [1, 2, 7, 33, 150]) {
      expect(progressFor(totalXpForLevel(level)).level).toBe(level);
      expect(progressFor(totalXpForLevel(level) - 1).level).toBe(level - 1);
    }
  });

  it('handles negative and fractional XP safely', () => {
    expect(progressFor(-50).level).toBe(0);
    expect(progressFor(100.9).level).toBe(1);
  });

  it('supports a custom curve', () => {
    const flat = { quadratic: 0, linear: 0, base: 1000 };
    expect(progressFor(5500, flat)).toEqual({ level: 5, current: 500, needed: 1000 });
  });

  it('caps the level so huge XP values stay fast', () => {
    expect(progressFor(Number.MAX_SAFE_INTEGER).level).toBe(1000);
  });
});

describe('messageXp', () => {
  it('stays within bounds and applies the multiplier', () => {
    expect(messageXp(15, 25, 1, () => 0)).toBe(15);
    expect(messageXp(15, 25, 1, () => 0.9999)).toBe(25);
    expect(messageXp(15, 25, 2, () => 0)).toBe(30);
    expect(messageXp(25, 15, 1, () => 0)).toBe(15);
  });
});

describe('rewardRoles', () => {
  const rewards = [
    { level: 10, roleId: 'gold' },
    { level: 5, roleId: 'silver' },
    { level: 20, roleId: 'diamond' },
  ];

  it('stacks every reached reward', () => {
    expect(rewardRoles(rewards, 12, true)).toEqual(['silver', 'gold']);
  });

  it('keeps only the highest reward when not stacking', () => {
    expect(rewardRoles(rewards, 25, false)).toEqual(['diamond']);
    expect(rewardRoles(rewards, 3, false)).toEqual([]);
  });
});
