import { PermissionFlagsBits, roleMention, SlashCommandBuilder } from 'discord.js';
import type { CommandContext } from '../../../core/context.js';
import { UserError } from '../../../core/errors.js';
import { nextSequence } from '../../../core/models/counter.js';
import { defineCommand } from '../../../core/module.js';
import { slotsReturnRate } from '../math.js';
import { EconomyProfileModel, ShopItemModel } from '../models.js';
import { economyConfig, economySettings, formatMoney, type EconomySettings } from '../settings.js';
import { profile } from '../wallet.js';
import { itemAutocomplete } from './shop.js';

const MAX_ITEMS = 50;

function statusPanel(ctx: CommandContext<true>, s: EconomySettings) {
  const m = (n: number) => formatMoney(n, s.currency);
  const onOff = (on: boolean) => ctx.t(on ? 'common.on' : 'common.off');
  const rtp = Math.round(slotsReturnRate(ctx.bot.moduleConfig({ name: 'economy', config: economyConfig }).slots) * 1000) / 10;
  return ctx
    .panel()
    .title(ctx.t('economy.admin.statusTitle'))
    .fields([
      {
        name: ctx.t('economy.admin.fields.basics'),
        value: ctx.t('economy.admin.basicsValue', { start: m(s.startBalance), limit: s.bankLimit ? m(s.bankLimit) : ctx.t('economy.admin.unlimited') }),
      },
      {
        name: ctx.t('economy.admin.fields.earnings'),
        value: ctx.t('economy.admin.earningsValue', {
          daily: m(s.daily.amount),
          bonus: m(s.daily.streakBonus),
          max: s.daily.maxStreak,
          weekly: m(s.weekly.amount),
          workMin: m(s.work.min),
          workMax: m(s.work.max),
          workCooldown: s.work.cooldownMinutes,
        }),
      },
      {
        name: ctx.t('economy.admin.fields.rob', { state: onOff(s.rob.enabled) }),
        value: ctx.t('economy.admin.robValue', {
          chance: s.rob.successChance,
          min: s.rob.minPercent,
          max: s.rob.maxPercent,
          fine: s.rob.finePercent,
          minTarget: m(s.rob.minTarget),
          cooldown: s.rob.cooldownMinutes,
        }),
      },
      {
        name: ctx.t('economy.admin.fields.gambling', { state: onOff(s.gambling.enabled) }),
        value: ctx.t('economy.admin.gamblingValue', {
          min: m(s.gambling.minBet),
          max: m(s.gambling.maxBet),
          coinflip: s.gambling.coinflipChance,
          blackjack: s.gambling.blackjackPays,
          rtp,
        }),
      },
    ]);
}

async function save(ctx: CommandContext<true>, patch: Partial<EconomySettings>) {
  return ctx.respond(statusPanel(ctx, await ctx.bot.settings.updateModule(ctx.guild.id, economySettings, patch)));
}

export const economyAdmin = defineCommand({
  data: new SlashCommandBuilder()
    .setName('economy')
    .setDescription('economy.admin.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('status').setDescription('economy.admin.status'))
    .addSubcommand((s) =>
      s
        .setName('basics')
        .setDescription('economy.admin.basics')
        .addStringOption((o) => o.setName('currency').setDescription('economy.admin.options.currency').setMaxLength(24))
        .addStringOption((o) => o.setName('symbol').setDescription('economy.admin.options.symbol').setMaxLength(8))
        .addIntegerOption((o) => o.setName('start_balance').setDescription('economy.admin.options.startBalance').setMinValue(0))
        .addIntegerOption((o) => o.setName('bank_limit').setDescription('economy.admin.options.bankLimit').setMinValue(0)),
    )
    .addSubcommand((s) =>
      s
        .setName('earnings')
        .setDescription('economy.admin.earnings')
        .addIntegerOption((o) => o.setName('daily').setDescription('economy.admin.options.daily').setMinValue(0))
        .addIntegerOption((o) => o.setName('streak_bonus').setDescription('economy.admin.options.streakBonus').setMinValue(0))
        .addIntegerOption((o) => o.setName('max_streak').setDescription('economy.admin.options.maxStreak').setMinValue(1).setMaxValue(365))
        .addIntegerOption((o) => o.setName('weekly').setDescription('economy.admin.options.weekly').setMinValue(0))
        .addIntegerOption((o) => o.setName('work_min').setDescription('economy.admin.options.workMin').setMinValue(0))
        .addIntegerOption((o) => o.setName('work_max').setDescription('economy.admin.options.workMax').setMinValue(0))
        .addIntegerOption((o) => o.setName('work_cooldown').setDescription('economy.admin.options.workCooldown').setMinValue(1).setMaxValue(10_080)),
    )
    .addSubcommand((s) =>
      s
        .setName('rob')
        .setDescription('economy.admin.rob')
        .addBooleanOption((o) => o.setName('enabled').setDescription('economy.admin.options.enabled'))
        .addNumberOption((o) => o.setName('chance').setDescription('economy.admin.options.robChance').setMinValue(0).setMaxValue(100))
        .addIntegerOption((o) => o.setName('min_percent').setDescription('economy.admin.options.minPercent').setMinValue(1).setMaxValue(100))
        .addIntegerOption((o) => o.setName('max_percent').setDescription('economy.admin.options.maxPercent').setMinValue(1).setMaxValue(100))
        .addIntegerOption((o) => o.setName('fine_percent').setDescription('economy.admin.options.finePercent').setMinValue(0).setMaxValue(100))
        .addIntegerOption((o) => o.setName('min_target').setDescription('economy.admin.options.minTarget').setMinValue(0))
        .addIntegerOption((o) => o.setName('cooldown').setDescription('economy.admin.options.robCooldown').setMinValue(1).setMaxValue(10_080)),
    )
    .addSubcommand((s) =>
      s
        .setName('gambling')
        .setDescription('economy.admin.gambling')
        .addBooleanOption((o) => o.setName('enabled').setDescription('economy.admin.options.enabled'))
        .addIntegerOption((o) => o.setName('min_bet').setDescription('economy.admin.options.minBet').setMinValue(1))
        .addIntegerOption((o) => o.setName('max_bet').setDescription('economy.admin.options.maxBet').setMinValue(1))
        .addNumberOption((o) => o.setName('coinflip_chance').setDescription('economy.admin.options.coinflipChance').setMinValue(0).setMaxValue(100))
        .addNumberOption((o) => o.setName('blackjack_pays').setDescription('economy.admin.options.blackjackPays').setMinValue(1).setMaxValue(3)),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('money')
        .setDescription('economy.admin.money.description')
        .addSubcommand((s) =>
          s
            .setName('give')
            .setDescription('economy.admin.money.give')
            .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true))
            .addIntegerOption((o) => o.setName('amount').setDescription('economy.options.amount').setRequired(true).setMinValue(1)),
        )
        .addSubcommand((s) =>
          s
            .setName('take')
            .setDescription('economy.admin.money.take')
            .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true))
            .addIntegerOption((o) => o.setName('amount').setDescription('economy.options.amount').setRequired(true).setMinValue(1)),
        )
        .addSubcommand((s) =>
          s
            .setName('reset')
            .setDescription('economy.admin.money.reset')
            .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true)),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('shop')
        .setDescription('economy.admin.shop.description')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('economy.admin.shop.add')
            .addStringOption((o) => o.setName('name').setDescription('economy.admin.options.itemName').setRequired(true).setMaxLength(60))
            .addIntegerOption((o) => o.setName('price').setDescription('economy.admin.options.price').setRequired(true).setMinValue(0))
            .addRoleOption((o) => o.setName('role').setDescription('economy.admin.options.role'))
            .addStringOption((o) => o.setName('description').setDescription('economy.admin.options.itemDescription').setMaxLength(200))
            .addIntegerOption((o) => o.setName('stock').setDescription('economy.admin.options.stock').setMinValue(0)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('economy.admin.shop.remove')
            .addIntegerOption((o) => o.setName('item').setDescription('economy.shop.options.item').setRequired(true).setAutocomplete(true)),
        ),
    ),
  defer: 'ephemeral',
  permissions: { user: PermissionFlagsBits.ManageGuild },
  autocomplete: itemAutocomplete,
  async run(ctx) {
    const { options } = ctx.interaction;
    const group = options.getSubcommandGroup();
    const sub = options.getSubcommand();
    const s = await ctx.bot.settings.module(ctx.guild.id, economySettings);
    const int = (name: string) => options.getInteger(name);
    const num = (name: string) => options.getNumber(name);

    if (!group) {
      switch (sub) {
        case 'status':
          return ctx.respond(statusPanel(ctx, s));
        case 'basics':
          return save(ctx, {
            currency: { name: options.getString('currency') ?? s.currency.name, symbol: options.getString('symbol') ?? s.currency.symbol },
            startBalance: int('start_balance') ?? s.startBalance,
            bankLimit: int('bank_limit') ?? s.bankLimit,
          });
        case 'earnings': {
          const work = { min: int('work_min') ?? s.work.min, max: int('work_max') ?? s.work.max, cooldownMinutes: int('work_cooldown') ?? s.work.cooldownMinutes };
          if (work.min > work.max) throw new UserError('leveling.errors.minMax');
          return save(ctx, {
            daily: { amount: int('daily') ?? s.daily.amount, streakBonus: int('streak_bonus') ?? s.daily.streakBonus, maxStreak: int('max_streak') ?? s.daily.maxStreak },
            weekly: { amount: int('weekly') ?? s.weekly.amount },
            work,
          });
        }
        case 'rob': {
          const rob = {
            enabled: options.getBoolean('enabled') ?? s.rob.enabled,
            successChance: num('chance') ?? s.rob.successChance,
            minPercent: int('min_percent') ?? s.rob.minPercent,
            maxPercent: int('max_percent') ?? s.rob.maxPercent,
            finePercent: int('fine_percent') ?? s.rob.finePercent,
            minTarget: int('min_target') ?? s.rob.minTarget,
            cooldownMinutes: int('cooldown') ?? s.rob.cooldownMinutes,
          };
          if (rob.minPercent > rob.maxPercent) throw new UserError('leveling.errors.minMax');
          return save(ctx, { rob });
        }
        case 'gambling': {
          const gambling = {
            enabled: options.getBoolean('enabled') ?? s.gambling.enabled,
            minBet: int('min_bet') ?? s.gambling.minBet,
            maxBet: int('max_bet') ?? s.gambling.maxBet,
            coinflipChance: num('coinflip_chance') ?? s.gambling.coinflipChance,
            blackjackPays: num('blackjack_pays') ?? s.gambling.blackjackPays,
          };
          if (gambling.minBet > gambling.maxBet) throw new UserError('leveling.errors.minMax');
          return save(ctx, { gambling });
        }
      }
    }

    if (group === 'money') {
      const user = options.getUser('user', true);
      if (user.bot) throw new UserError('economy.errors.bot');
      await profile(ctx.guild.id, user.id, s.startBalance);
      const amount = int('amount') ?? 0;
      if (sub === 'give') await EconomyProfileModel.updateOne({ guildId: ctx.guild.id, userId: user.id }, { $inc: { wallet: amount } });
      // Taking can go into the bank once the wallet is empty, but never below zero overall.
      if (sub === 'take') {
        const p = (await EconomyProfileModel.findOne({ guildId: ctx.guild.id, userId: user.id }).lean())!;
        const fromWallet = Math.min(p.wallet, amount);
        const fromBank = Math.min(p.bank, amount - fromWallet);
        await EconomyProfileModel.updateOne(
          { guildId: ctx.guild.id, userId: user.id, wallet: { $gte: fromWallet }, bank: { $gte: fromBank } },
          { $inc: { wallet: -fromWallet, bank: -fromBank } },
        );
      }
      if (sub === 'reset') {
        await EconomyProfileModel.updateOne(
          { guildId: ctx.guild.id, userId: user.id },
          { wallet: s.startBalance, bank: 0, inventory: [], dailyStreak: 0, lastDaily: null, lastWeekly: null, lastWork: null, lastRob: null },
        );
      }
      const p = (await EconomyProfileModel.findOne({ guildId: ctx.guild.id, userId: user.id }).lean())!;
      return ctx.respond(
        ctx.successPanel(
          ctx.t('economy.admin.money.done', {
            user: user.toString(),
            wallet: formatMoney(p.wallet, s.currency),
            bank: formatMoney(p.bank, s.currency),
          }),
        ),
      );
    }

    if (group === 'shop') {
      if (sub === 'remove') {
        const { deletedCount } = await ShopItemModel.deleteOne({ guildId: ctx.guild.id, itemId: int('item') });
        if (deletedCount === 0) throw new UserError('economy.shop.notFound');
        return ctx.respond(ctx.successPanel(ctx.t('economy.admin.shop.removed')));
      }
      if ((await ShopItemModel.countDocuments({ guildId: ctx.guild.id })) >= MAX_ITEMS) throw new UserError('ai.errors.listFull', { max: MAX_ITEMS });
      const role = options.getRole('role');
      const me = ctx.guild.members.me;
      if (role && (role.managed || role.id === ctx.guild.id || !me || me.roles.highest.comparePositionTo(role.id) <= 0)) {
        throw new UserError('moderation.errors.botRoleHierarchy', { role: role.toString() });
      }
      const name = options.getString('name', true);
      await ShopItemModel.create({
        guildId: ctx.guild.id,
        itemId: await nextSequence(`shop:${ctx.guild.id}`),
        name,
        price: int('price') ?? 0,
        roleId: role?.id ?? null,
        description: options.getString('description'),
        stock: int('stock'),
      });
      return ctx.respond(
        ctx.successPanel(
          ctx.t('economy.admin.shop.added', { name, price: formatMoney(int('price') ?? 0, s.currency) }) +
            (role ? `\n${ctx.t('economy.shop.givesRole', { role: roleMention(role.id) })}` : ''),
        ),
      );
    }
  },
});
