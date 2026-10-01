import { SlashCommandBuilder } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand } from '../../../core/module.js';
import { economyOf, readBet } from '../helpers.js';
import { coinflipWins, payout, slotsMultiplier, spin } from '../math.js';
import { economyConfig } from '../settings.js';
import { credit, debit } from '../wallet.js';

export const coinflip = defineCommand({
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('economy.coinflip.description')
    .addStringOption((o) => o.setName('bet').setDescription('economy.options.bet').setRequired(true).setMaxLength(20))
    .addStringOption((o) =>
      o
        .setName('side')
        .setDescription('economy.coinflip.options.side')
        .setRequired(true)
        .addChoices({ name: 'economy.coinflip.heads', value: 'heads' }, { name: 'economy.coinflip.tails', value: 'tails' }),
    ),
  async run(ctx) {
    const { account, settings, money } = await economyOf(ctx);
    const bet = readBet(ctx, settings, account.wallet);
    if (!(await debit(ctx.guild.id, ctx.member.id, bet))) throw new UserError('economy.errors.funds');

    const call = ctx.interaction.options.getString('side', true);
    const won = coinflipWins(settings.gambling.coinflipChance);
    const landed = won ? call : call === 'heads' ? 'tails' : 'heads';
    if (won) await credit(ctx.guild.id, ctx.member.id, payout(bet, 2));

    const text = ctx.t(won ? 'economy.coinflip.won' : 'economy.coinflip.lost', { side: ctx.t(`economy.coinflip.${landed}`), amount: money(bet) });
    await ctx.respond(won ? ctx.successPanel(text) : ctx.errorPanel(text));
  },
});

export const slots = defineCommand({
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('economy.slots.description')
    .addStringOption((o) => o.setName('bet').setDescription('economy.options.bet').setRequired(true).setMaxLength(20)),
  async run(ctx) {
    const { account, settings, money } = await economyOf(ctx);
    const bet = readBet(ctx, settings, account.wallet);
    if (!(await debit(ctx.guild.id, ctx.member.id, bet))) throw new UserError('economy.errors.funds');

    const reels = spin(ctx.bot.moduleConfig({ name: 'economy', config: economyConfig }).slots);
    const multiplier = slotsMultiplier(reels);
    const won = payout(bet, multiplier);
    if (won > 0) await credit(ctx.guild.id, ctx.member.id, won);

    const line = reels.map((s) => ctx.t(`economy.slots.symbols.${s.id}`)).join('  |  ');
    const result =
      won > bet
        ? ctx.t('economy.slots.won', { amount: money(won), multiplier })
        : won > 0
          ? ctx.t('economy.slots.partial', { amount: money(won) })
          : ctx.t('economy.slots.lost', { amount: money(bet) });
    const panel = won > bet ? ctx.successPanel(`## ${line}`) : won > 0 ? ctx.panel().text(`## ${line}`) : ctx.errorPanel(`## ${line}`);
    await ctx.respond(panel.text(result));
  },
});
