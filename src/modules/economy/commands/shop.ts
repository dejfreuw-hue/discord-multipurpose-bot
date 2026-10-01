import { roleMention, SlashCommandBuilder, type AutocompleteInteraction } from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand } from '../../../core/module.js';
import { economyOf } from '../helpers.js';
import { ShopItemModel, type ShopItemDoc } from '../models.js';
import { formatMoney } from '../settings.js';
import { addItem, credit, debit } from '../wallet.js';

export async function itemAutocomplete(interaction: AutocompleteInteraction, _bot: Bot): Promise<void> {
  if (!interaction.guildId) return interaction.respond([]);
  const typed = String(interaction.options.getFocused()).toLowerCase();
  const items = await ShopItemModel.find({ guildId: interaction.guildId }).sort({ price: 1 }).lean<ShopItemDoc[]>();
  await interaction.respond(
    items
      .filter((i) => i.name.toLowerCase().includes(typed) || String(i.itemId) === typed)
      .slice(0, 25)
      .map((i) => ({ name: `${i.name} (${i.price.toLocaleString('en-US')})`.slice(0, 100), value: i.itemId })),
  );
}

async function restock(guildId: string, item: ShopItemDoc): Promise<void> {
  if (item.stock !== null) await ShopItemModel.updateOne({ guildId, itemId: item.itemId }, { $inc: { stock: 1 } });
}

export const shop = defineCommand({
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('economy.shop.description')
    .addSubcommand((s) => s.setName('view').setDescription('economy.shop.view'))
    .addSubcommand((s) =>
      s
        .setName('buy')
        .setDescription('economy.shop.buy')
        .addIntegerOption((o) => o.setName('item').setDescription('economy.shop.options.item').setRequired(true).setAutocomplete(true)),
    ),
  autocomplete: itemAutocomplete,
  async run(ctx) {
    const { settings, money } = await economyOf(ctx);

    if (ctx.interaction.options.getSubcommand() === 'view') {
      const items = await ShopItemModel.find({ guildId: ctx.guild.id }).sort({ price: 1 }).limit(25).lean<ShopItemDoc[]>();
      if (items.length === 0) throw new UserError('economy.shop.empty');
      const fields = items.map((i) => ({
        name: `${i.name} · ${formatMoney(i.price, settings.currency)}`,
        value: [
          i.description,
          i.roleId ? ctx.t('economy.shop.givesRole', { role: roleMention(i.roleId) }) : null,
          i.stock !== null ? ctx.t('economy.shop.stock', { count: i.stock }) : null,
        ]
          .filter(Boolean)
          .join('\n') || '-',
      }));
      await ctx.respond(ctx.panel().title(ctx.t('economy.shop.title')).fields(fields).footer(ctx.t('economy.shop.footer')));
      return;
    }

    const item = await ShopItemModel.findOne({ guildId: ctx.guild.id, itemId: ctx.interaction.options.getInteger('item', true) }).lean<ShopItemDoc>();
    if (!item) throw new UserError('economy.shop.notFound');
    if (item.roleId && ctx.member.roles.cache.has(item.roleId)) throw new UserError('economy.shop.owned');
    if (item.roleId) {
      const role = ctx.guild.roles.cache.get(item.roleId);
      const me = ctx.guild.members.me;
      if (!role || !me || role.managed || me.roles.highest.comparePositionTo(role) <= 0) throw new UserError('economy.shop.roleBroken');
    }

    // Reserve stock first so two buyers can't both get the last one.
    if (item.stock !== null) {
      const reserved = await ShopItemModel.updateOne({ guildId: ctx.guild.id, itemId: item.itemId, stock: { $gt: 0 } }, { $inc: { stock: -1 } });
      if (reserved.modifiedCount === 0) throw new UserError('economy.shop.soldOut');
    }
    if (!(await debit(ctx.guild.id, ctx.member.id, item.price))) {
      await restock(ctx.guild.id, item);
      throw new UserError('economy.errors.funds');
    }

    if (item.roleId) {
      try {
        await ctx.member.roles.add(item.roleId, `bought "${item.name}" in the shop`);
      } catch (err) {
        await credit(ctx.guild.id, ctx.member.id, item.price);
        await restock(ctx.guild.id, item);
        ctx.bot.logger.warn({ err, guild: ctx.guild.id }, 'shop role purchase failed');
        throw new UserError('economy.shop.roleBroken');
      }
    } else {
      await addItem(ctx.guild.id, ctx.member.id, item.itemId);
    }
    await ctx.respond(ctx.successPanel(ctx.t('economy.shop.bought', { item: item.name, amount: money(item.price) })));
  },
});

export const inventory = defineCommand({
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('economy.inventory.description')
    .addUserOption((o) => o.setName('user').setDescription('economy.balance.options.user')),
  async run(ctx) {
    const user = ctx.interaction.options.getUser('user') ?? ctx.interaction.user;
    const { account } = await economyOf(ctx, user.id);
    const owned = account.inventory.filter((i) => i.quantity > 0);
    if (owned.length === 0) throw new UserError('economy.inventory.empty', { user: user.toString() });
    const items = await ShopItemModel.find({ guildId: ctx.guild.id, itemId: { $in: owned.map((i) => i.itemId) } }).lean<ShopItemDoc[]>();
    const lines = owned.map((o) => {
      const name = items.find((i) => i.itemId === o.itemId)?.name ?? ctx.t('economy.inventory.removedItem', { id: o.itemId });
      return `**${o.quantity}x** ${name}`;
    });
    await ctx.respond(ctx.panel().title(ctx.t('economy.inventory.title', { user: user.displayName })).text(lines.join('\n')));
  },
});
