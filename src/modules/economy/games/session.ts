import { randomBytes } from 'node:crypto';
import { shuffledDeck, type Card } from './blackjack.js';

export interface BlackjackGame {
  id: string;
  guildId: string;
  userId: string;
  /** Total stake, including the extra bet from doubling down. */
  bet: number;
  deck: Card[];
  player: Card[];
  dealer: Card[];
  doubled: boolean;
  timer: NodeJS.Timeout | null;
  /** Set while a button press is being handled, so a double click can't play two moves. */
  busy: boolean;
  /** Set once the game is paid out, so a timeout racing a final move can't pay twice. */
  settled: boolean;
}

/**
 * Games in progress. The stake has already left the wallet, so anything still here when the
 * bot shuts down is refunded (see the module's stop hook).
 */
export const games = new Map<string, BlackjackGame>();
const byPlayer = new Map<string, string>();

export function startGame(guildId: string, userId: string, bet: number): BlackjackGame {
  const deck = shuffledDeck(Math.random, 2);
  const game: BlackjackGame = {
    id: randomBytes(4).toString('hex'),
    guildId,
    userId,
    bet,
    deck,
    player: [deck.pop()!, deck.pop()!],
    dealer: [deck.pop()!, deck.pop()!],
    doubled: false,
    timer: null,
    busy: false,
    settled: false,
  };
  games.set(game.id, game);
  byPlayer.set(`${guildId}:${userId}`, game.id);
  return game;
}

export function activeGame(guildId: string, userId: string): BlackjackGame | undefined {
  const id = byPlayer.get(`${guildId}:${userId}`);
  return id ? games.get(id) : undefined;
}

export function endGame(game: BlackjackGame): void {
  if (game.timer) clearTimeout(game.timer);
  games.delete(game.id);
  byPlayer.delete(`${game.guildId}:${game.userId}`);
}
