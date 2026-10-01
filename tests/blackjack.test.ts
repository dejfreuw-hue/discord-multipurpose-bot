import { describe, expect, it } from 'vitest';
import { cardLabel, handValue, isBlackjack, outcomeMultiplier, playDealer, settle, shuffledDeck, type Card } from '../src/modules/economy/games/blackjack.js';

const c = (...ranks: number[]): Card[] => ranks.map((rank) => ({ rank, suit: 0 }));

describe('handValue', () => {
  it('counts face cards as ten', () => {
    expect(handValue(c(13, 12))).toEqual({ total: 20, soft: false });
  });

  it('counts aces as 11 until that would bust', () => {
    expect(handValue(c(1, 6))).toEqual({ total: 17, soft: true });
    expect(handValue(c(1, 6, 10))).toEqual({ total: 17, soft: false });
    expect(handValue(c(1, 1, 9))).toEqual({ total: 21, soft: true });
    expect(handValue(c(1, 1, 1, 1))).toEqual({ total: 14, soft: true });
  });
});

describe('dealer', () => {
  it('draws to 17 and stands on soft 17', () => {
    const deck = c(5, 10);
    expect(handValue(playDealer(c(1, 6), deck)).total).toBe(17);
    expect(deck).toHaveLength(2);
    expect(handValue(playDealer(c(10, 2), deck)).total).toBe(22);
  });
});

describe('settle', () => {
  it('handles naturals', () => {
    expect(isBlackjack(c(1, 13))).toBe(true);
    expect(isBlackjack(c(1, 5, 5))).toBe(false);
    expect(settle(c(1, 13), c(10, 9))).toBe('blackjack');
    expect(settle(c(1, 13), c(1, 12))).toBe('push');
    expect(settle(c(10, 9), c(1, 12))).toBe('lose');
  });

  it('compares totals and busts', () => {
    expect(settle(c(10, 9), c(10, 8))).toBe('win');
    expect(settle(c(10, 8), c(10, 8))).toBe('push');
    expect(settle(c(10, 6, 10), c(10, 8))).toBe('bust');
    expect(settle(c(10, 6), c(10, 6, 10))).toBe('win');
    expect(settle(c(10, 5, 6), c(1, 13))).toBe('lose');
  });

  it('pays the right multiple of the stake', () => {
    expect(outcomeMultiplier('blackjack')).toBe(2.5);
    expect(outcomeMultiplier('blackjack', 1.2)).toBe(2.2);
    expect(outcomeMultiplier('win')).toBe(2);
    expect(outcomeMultiplier('push')).toBe(1);
    expect(outcomeMultiplier('lose')).toBe(0);
    expect(outcomeMultiplier('bust')).toBe(0);
  });
});

describe('deck', () => {
  it('has 52 unique cards per deck', () => {
    const deck = shuffledDeck();
    expect(new Set(deck.map(cardLabel)).size).toBe(52);
    expect(shuffledDeck(Math.random, 2)).toHaveLength(104);
  });
});
