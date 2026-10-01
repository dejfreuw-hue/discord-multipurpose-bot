import { SlashCommandBuilder } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand } from '../../../core/module.js';
import { cooldownError, economyOf } from '../helpers.js';
import { dailyReward, nextStreak, randomInt, robOutcome } from '../math.js';
import { EconomyProfileModel } from '../models.js';
import { claim, credit, debit, profile, readyAt } from '../wallet.js';

const DAY = 86_400_000;

export const daily = defineCommand({
  data: new SlashCommandBuilder().setName('daily').setDescription('economy.daily.description'),
  cooldown: 0,
  async run(ctx) {
    const { account, settings, money } = await economyOf(ctx);
    const wait = readyAt(account.lastDaily, DAY);
    if (wait) throw cooldownError(wait);
    const streak = nextStreak(account.lastDaily, account.dailyStreak, new Date());
    const reward = dailyReward(settings.daily.amount, settings.daily.streakBonus, streak, settings.daily.maxStreak);
    if (!(await claim(ctx.guild.id, ctx.member.id, 'lastDaily', account.lastDaily, reward, { dailyStreak: streak }))) {
      throw new UserError('economy.errors.alreadyClaimed');
    }
    await ctx.respond(ctx.successPanel(ctx.t('economy.daily.done', { amount: money(reward), streak })));
  },
});

export const weekly = defineCommand({
  data: new SlashCommandBuilder().setName('weekly').setDescription('economy.weekly.description'),
  cooldown: 0,
  async run(ctx) {
    const { account, settings, money } = await economyOf(ctx);
    const wait = readyAt(account.lastWeekly, 7 * DAY);
    if (wait) throw cooldownError(wait);
    if (!(await claim(ctx.guild.id, ctx.member.id, 'lastWeekly', account.lastWeekly, settings.weekly.amount))) {
      throw new UserError('economy.errors.alreadyClaimed');
    }
    await ctx.respond(ctx.successPanel(ctx.t('economy.weekly.done', { amount: money(settings.weekly.amount) })));
  },
});

export const work = defineCommand({
  data: new SlashCommandBuilder().setName('work').setDescription('economy.work.description'),
  cooldown: 0,
  async run(ctx) {
    const { account, settings, money } = await economyOf(ctx);
    const wait = readyAt(account.lastWork, settings.work.cooldownMinutes * 60_000);
    if (wait) throw cooldownError(wait);
    const reward = randomInt(settings.work.min, settings.work.max);
    if (!(await claim(ctx.guild.id, ctx.member.id, 'lastWork', account.lastWork, reward))) throw new UserError('economy.errors.alreadyClaimed');

    // The job list is one translated string with a job per line, so translators control it.
    const jobs = ctx.t('economy.work.jobs').split('\n').filter(Boolean);
    const job = jobs[Math.floor(Math.random() * jobs.length)] ?? '';
    await ctx.respond(ctx.successPanel(ctx.t('economy.work.done', { job, amount: money(reward) })));
  },
});

export const rob = defineCommand({
  data: new SlashCommandBuilder()
    .setName('rob')
    .setDescription('economy.rob.description')
    .addUserOption((o) => o.setName('user').setDescription('economy.rob.options.user').setRequired(true)),
  cooldown: 0,
  async run(ctx) {
    const target = ctx.interaction.options.getUser('user', true);
    if (target.bot) throw new UserError('economy.errors.bot');
    if (target.id === ctx.member.id) throw new UserError('economy.errors.self');
    const { account, settings, money } = await economyOf(ctx);
    const rules = settings.rob;
    if (!rules.enabled) throw new UserError('economy.rob.disabled');
    const wait = readyAt(account.lastRob, rules.cooldownMinutes * 60_000);
    if (wait) throw cooldownError(wait);

    const victim = await profile(ctx.guild.id, target.id, settings.startBalance);
    if (victim.wallet < rules.minTarget) throw new UserError('economy.rob.poorTarget', { user: target.toString(), amount: money(rules.minTarget) });
    if (!(await claim(ctx.guild.id, ctx.member.id, 'lastRob', account.lastRob, 0))) throw new UserError('economy.errors.alreadyClaimed');

    const outcome = robOutcome(rules, victim.wallet, account.wallet);
    if (outcome.success) {
      // The victim may have spent some since we looked; take what's taken only if it's still there.
      const stolen = Math.min(outcome.amount, (await EconomyProfileModel.findOne({ guildId: ctx.guild.id, userId: target.id }).lean())?.wallet ?? 0);
      if (stolen > 0 && (await debit(ctx.guild.id, target.id, stolen))) {
        await credit(ctx.guild.id, ctx.member.id, stolen);
        await ctx.respond(ctx.successPanel(ctx.t('economy.rob.success', { user: target.toString(), amount: money(stolen) })));
        return;
      }
      await ctx.respond(ctx.panel().text(ctx.t('economy.rob.empty', { user: target.toString() })));
      return;
    }

    const fine = outcome.fine;
    if (fine > 0 && (await debit(ctx.guild.id, ctx.member.id, fine))) await credit(ctx.guild.id, target.id, fine);
    await ctx.respond(ctx.errorPanel(ctx.t('economy.rob.caught', { user: target.toString(), amount: money(fine) })));
  },
});
