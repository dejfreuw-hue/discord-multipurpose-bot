import { time, TimestampStyles } from 'discord.js';
import type { CommandContext } from '../../core/context.js';
import { UserError } from '../../core/errors.js';
import { parseAmount } from './math.js';
import { economySettings, formatMoney, type EconomySettings } from './settings.js';
import { profile } from './wallet.js';

/** Settings, a money formatter and the member's profile, which most economy commands need together. */
export async function economyOf(ctx: CommandContext<true>, userId = ctx.member.id) {
  const settings = await ctx.bot.settings.module(ctx.guild.id, economySettings);
  const account = await profile(ctx.guild.id, userId, settings.startBalance);
  const money = (n: number) => `**${formatMoney(n, settings.currency)}**`;
  return { settings, account, money };
}

export function readAmount(ctx: CommandContext<true>, option: string, available: number): number {
  const raw = ctx.interaction.options.getString(option, true);
  const amount = parseAmount(raw, available);
  if (amount === null) throw new UserError('economy.errors.amount', { value: raw });
  return amount;
}

export function readBet(ctx: CommandContext<true>, settings: EconomySettings, wallet: number): number {
  if (!settings.gambling.enabled) throw new UserError('economy.errors.gamblingOff');
  const bet = readAmount(ctx, 'bet', wallet);
  const money = (n: number) => formatMoney(n, settings.currency);
  if (bet < settings.gambling.minBet) throw new UserError('economy.errors.minBet', { amount: money(settings.gambling.minBet) });
  if (bet > settings.gambling.maxBet) throw new UserError('economy.errors.maxBet', { amount: money(settings.gambling.maxBet) });
  return bet;
}

export function cooldownError(at: Date): UserError {
  return new UserError('economy.errors.cooldown', { time: time(at, TimestampStyles.RelativeTime) });
}
