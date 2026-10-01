import { z } from 'zod';
import type { SettingsSlice } from '../../core/guild-settings.js';

const symbol = z.strictObject({
  id: z.string().regex(/^[a-z]+$/, 'must be lowercase letters; the symbol itself comes from the locale file'),
  weight: z.number().positive(),
  three: z.number().min(0),
  two: z.number().min(0),
});

export const economyConfig = z.object({
  /**
   * Slot symbols and payouts. Weights are relative odds per reel. The defaults return 94% of
   * bets over time; the startup log prints the return rate of whatever is configured.
   */
  slots: z
    .array(symbol)
    .min(2)
    .default([
      { id: 'cherry', weight: 30, three: 6, two: 0.75 },
      { id: 'lemon', weight: 25, three: 8, two: 0.75 },
      { id: 'bell', weight: 20, three: 12, two: 1 },
      { id: 'clover', weight: 13, three: 25, two: 1.5 },
      { id: 'seven', weight: 8, three: 60, two: 2 },
      { id: 'diamond', weight: 4, three: 200, two: 3 },
    ]),
  blackjackTimeoutSeconds: z.number().int().min(30).max(600).default(120),
});

const guildSettings = z.object({
  currency: z
    .object({
      name: z.string().min(1).max(24).default('coins'),
      /** Shown before amounts instead of the name, e.g. "$". Empty uses the name. */
      symbol: z.string().max(8).default(''),
    })
    .prefault({}),
  startBalance: z.number().int().min(0).default(0),
  /** Most a member can keep in the bank. 0 is unlimited. */
  bankLimit: z.number().int().min(0).default(0),
  daily: z
    .object({
      amount: z.number().int().min(0).default(500),
      streakBonus: z.number().int().min(0).default(50),
      maxStreak: z.number().int().min(1).max(365).default(10),
    })
    .prefault({}),
  weekly: z.object({ amount: z.number().int().min(0).default(3000) }).prefault({}),
  work: z
    .object({
      min: z.number().int().min(0).default(100),
      max: z.number().int().min(0).default(400),
      cooldownMinutes: z.number().int().min(1).max(10_080).default(60),
    })
    .prefault({}),
  rob: z
    .object({
      enabled: z.boolean().default(true),
      successChance: z.number().min(0).max(100).default(40),
      minPercent: z.number().int().min(1).max(100).default(10),
      maxPercent: z.number().int().min(1).max(100).default(30),
      finePercent: z.number().int().min(0).max(100).default(15),
      minTarget: z.number().int().min(0).default(200),
      cooldownMinutes: z.number().int().min(1).max(10_080).default(120),
    })
    .prefault({}),
  gambling: z
    .object({
      enabled: z.boolean().default(true),
      minBet: z.number().int().min(1).default(10),
      maxBet: z.number().int().min(1).default(50_000),
      coinflipChance: z.number().min(0).max(100).default(50),
      blackjackPays: z.number().min(1).max(3).default(1.5),
    })
    .prefault({}),
});

export type EconomySettings = z.output<typeof guildSettings>;

export const economySettings: SettingsSlice<typeof guildSettings> = { name: 'economy', guildSettings };

export function formatMoney(amount: number, currency: EconomySettings['currency']): string {
  const number = Math.floor(amount).toLocaleString('en-US');
  return currency.symbol ? `${currency.symbol}${number}` : `${number} ${currency.name}`;
}
