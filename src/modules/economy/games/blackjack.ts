import type { Random } from '../math.js';

export interface Card {
  /** 1 (ace) to 13 (king). */
  rank: number;
  suit: 0 | 1 | 2 | 3;
}

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

export function cardLabel(card: Card): string {
  return `${RANKS[card.rank - 1]}${SUITS[card.suit]}`;
}

export function shuffledDeck(random: Random = Math.random, decks = 1): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) {
    for (let suit = 0; suit < 4; suit++) for (let rank = 1; rank <= 13; rank++) cards.push({ rank, suit: suit as Card['suit'] });
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
  return cards;
}

/** Best total for a hand. `soft` means an ace is still counted as 11. */
export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 1) {
      aces++;
      total += 11;
    } else {
      total += Math.min(card.rank, 10);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export function isBlackjack(cards: readonly Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

/** The dealer draws to 17 and stands on every 17, soft ones included. */
export function playDealer(hand: Card[], deck: Card[]): Card[] {
  while (handValue(hand).total < 17) hand.push(deck.pop()!);
  return hand;
}

export type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

export function settle(player: readonly Card[], dealer: readonly Card[]): Outcome {
  const p = handValue(player).total;
  const d = handValue(dealer).total;
  if (p > 21) return 'bust';
  const playerBj = isBlackjack(player);
  const dealerBj = isBlackjack(dealer);
  if (playerBj && dealerBj) return 'push';
  if (playerBj) return 'blackjack';
  if (dealerBj) return 'lose';
  if (d > 21 || p > d) return 'win';
  if (p === d) return 'push';
  return 'lose';
}

/** How much of the stake comes back: 2 for a win (stake plus winnings), 1 for a push, 0 for a loss. */
export function outcomeMultiplier(outcome: Outcome, blackjackPays = 1.5): number {
  switch (outcome) {
    case 'blackjack':
      return 1 + blackjackPays;
    case 'win':
      return 2;
    case 'push':
      return 1;
    default:
      return 0;
  }
}
