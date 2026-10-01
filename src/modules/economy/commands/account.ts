import { ButtonBuilder, ButtonStyle, SlashCommandBuilder, userMention } from 'discord.js';
import type { InteractionContext } from '../../../core/context.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand, defineComponent } from '../../../core/module.js';
import { economyOf, readAmount } from '../helpers.js';
import { EconomyProfileModel } from '../models.js';
import { economySettings, formatMoney } from '../settings.js';
import { deposit, profile, transfer, withdraw } from '../wallet.js';

export const balance = defineCommand({
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('economy.balance.description')
    .addUserOption((o) => o.setName('user').setDescription('economy.balance.options.user')),
  async run(ctx) {
    const user = ctx.interaction.options.getUser('user') ?? ctx.interaction.user;
    if (user.bot) throw new UserError('economy.errors.bot');
    const { account, money, settings } = await economyOf(ctx, user.id);
    const rank = (await EconomyProfileModel.countDocuments({ guildId: ctx.guild.id, $expr: { $gt: [{ $add: ['$wallet', '$bank'] }, account.wallet + account.bank] } })) + 1;
    await ctx.respond(
      ctx
        .panel()
        .title(ctx.t('economy.balance.title', { user: user.displayName }))
        .thumbnail(user.displayAvatarURL({ size: 128 }))
        .fields([
          { name: ctx.t('economy.balance.wallet'), value: money(account.wallet), inline: true },
          {
            name: ctx.t('economy.balance.bank'),
            value: settings.bankLimit > 0 ? `${money(account.bank)} / ${formatMoney(settings.bankLimit, settings.currency)}` : money(account.bank),
            inline: true,
          },
          { name: ctx.t('economy.balance.total'), value: `${money(account.wallet + account.bank)}\n-# ${ctx.t('economy.balance.rank', { rank })}`, inline: true },
        ]),
    );
  },
});

export const depositCommand = defineCommand({
  data: new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('economy.deposit.description')
    .addStringOption((o) => o.setName('amount').setDescription('economy.options.amount').setRequired(true).setMaxLength(20)),
  async run(ctx) {
    const { account, settings, money } = await economyOf(ctx);
    const room = settings.bankLimit > 0 ? Math.max(0, settings.bankLimit - account.bank) : account.wallet;
    const amount = Math.min(readAmount(ctx, 'amount', Math.min(account.wallet, room)), account.wallet);
    if (settings.bankLimit > 0 && amount > room) throw new UserError('economy.errors.bankFull', { amount: money(room) });
    if (!(await deposit(ctx.guild.id, ctx.member.id, amount, settings.bankLimit))) throw new UserError('economy.errors.funds');
    await ctx.respond(ctx.successPanel(ctx.t('economy.deposit.done', { amount: money(amount) })));
  },
});

export const withdrawCommand = defineCommand({
  data: new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('economy.withdraw.description')
    .addStringOption((o) => o.setName('amount').setDescription('economy.options.amount').setRequired(true).setMaxLength(20)),
  async run(ctx) {
    const { account, money } = await economyOf(ctx);
    const amount = readAmount(ctx, 'amount', account.bank);
    if (!(await withdraw(ctx.guild.id, ctx.member.id, amount))) throw new UserError('economy.errors.bankFunds');
    await ctx.respond(ctx.successPanel(ctx.t('economy.withdraw.done', { amount: money(amount) })));
  },
});

export const pay = defineCommand({
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('economy.pay.description')
    .addUserOption((o) => o.setName('user').setDescription('economy.pay.options.user').setRequired(true))
    .addStringOption((o) => o.setName('amount').setDescription('economy.options.amount').setRequired(true).setMaxLength(20)),
  async run(ctx) {
    const user = ctx.interaction.options.getUser('user', true);
    if (user.bot) throw new UserError('economy.errors.bot');
    if (user.id === ctx.member.id) throw new UserError('economy.errors.self');
    const { account, money, settings } = await economyOf(ctx);
    const amount = readAmount(ctx, 'amount', account.wallet);
    await profile(ctx.guild.id, user.id, settings.startBalance);
    if (!(await transfer(ctx.guild.id, ctx.member.id, user.id, amount))) throw new UserError('economy.errors.funds');
    await ctx.respond(ctx.successPanel(ctx.t('economy.pay.done', { amount: money(amount), user: user.toString() })));
  },
});

const PAGE_SIZE = 10;

async function richest(ctx: InteractionContext, guildId: string, page: number) {
  const settings = await ctx.bot.settings.module(guildId, economySettings);
  const filter = { guildId, $expr: { $gt: [{ $add: ['$wallet', '$bank'] }, 0] } };
  const total = await EconomyProfileModel.countDocuments(filter);
  if (total === 0) throw new UserError('economy.baltop.empty');
  const pages = Math.ceil(total / PAGE_SIZE);
  const current = Math.min(Math.max(0, page), pages - 1);
  const rows = await EconomyProfileModel.aggregate<{ userId: string; net: number }>([
    { $match: filter },
    { $project: { userId: 1, net: { $add: ['$wallet', '$bank'] } } },
    { $sort: { net: -1, _id: 1 } },
    { $skip: current * PAGE_SIZE },
    { $limit: PAGE_SIZE },
  ]);
  const lines = rows.map((r, i) => `**${current * PAGE_SIZE + i + 1}.** ${userMention(r.userId)} · ${formatMoney(r.net, settings.currency)}`);
  const id = (p: number) => `economy:baltop:${p}`;
  return ctx
    .panel()
    .title(ctx.t('economy.baltop.title'))
    .text(lines.join('\n'))
    .footer(ctx.t('moderation.case.page', { page: current + 1, pages }))
    .row(
      new ButtonBuilder().setCustomId(id(current - 1)).setStyle(ButtonStyle.Secondary).setLabel(ctx.t('moderation.case.previous')).setDisabled(current === 0),
      new ButtonBuilder().setCustomId(id(current + 1)).setStyle(ButtonStyle.Secondary).setLabel(ctx.t('moderation.case.next')).setDisabled(current + 1 >= pages),
    );
}

export const baltopPage = defineComponent({
  kind: 'button',
  id: 'economy:baltop',
  async run(ctx, [page]) {
    await ctx.update(await richest(ctx, ctx.guild.id, Number(page) || 0));
  },
});

export const baltop = defineCommand({
  data: new SlashCommandBuilder()
    .setName('baltop')
    .setDescription('economy.baltop.description')
    .addIntegerOption((o) => o.setName('page').setDescription('leveling.leaderboard.options.page').setMinValue(1)),
  async run(ctx) {
    await ctx.respond(await richest(ctx, ctx.guild.id, (ctx.interaction.options.getInteger('page') ?? 1) - 1));
  },
});
