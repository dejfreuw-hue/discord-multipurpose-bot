import {
  ButtonBuilder,
  ButtonStyle,
  roleMention,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Guild,
  type GuildMember,
} from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import { emojiKey, reactionKey } from '../../../core/emoji.js';
import { UserError } from '../../../core/errors.js';
import { defineComponent } from '../../../core/module.js';
import { applyRoles, selectRoles, toggleRoles } from './logic.js';
import { RoleMenuModel, type RoleMenuDoc } from './model.js';

/** Message IDs of posted reaction menus, so reaction events can skip every other message cheaply. */
export const reactionMenus = new Set<string>();

export async function loadReactionMenus(): Promise<void> {
  const menus = await RoleMenuModel.find({ mode: 'reactions', messageId: { $ne: null } }, { messageId: 1 }).lean();
  for (const m of menus) if (m.messageId) reactionMenus.add(m.messageId);
}

export async function findMenu(guildId: string, menuId: number): Promise<RoleMenuDoc> {
  const menu = await RoleMenuModel.findOne({ guildId, menuId }).lean<RoleMenuDoc>();
  if (!menu) throw new UserError('roles.errors.noMenu', { id: menuId });
  return menu;
}

async function renderMenu(bot: Bot, guild: Guild, menu: RoleMenuDoc) {
  const core = await bot.settings.get(guild.id);
  const t = (key: string) => bot.i18n.t(bot.guildLocale(core), key);
  const lines = menu.options.map((o) => `${o.emoji ? `${o.emoji} ` : ''}${roleMention(o.roleId)}${o.description ? ` - ${o.description}` : ''}`);
  const panel = bot
    .panel(core.color ?? bot.config.bot.color)
    .title(menu.title)
    .text(menu.description || null, lines.join('\n'))
    .footer(t(menu.exclusive ? 'roles.menu.footerExclusive' : `roles.menu.footer.${menu.mode}`));

  if (menu.mode === 'buttons') {
    const buttons = menu.options.slice(0, 25).map((o) => {
      const b = new ButtonBuilder().setCustomId(`roles:toggle:${menu.menuId}:${o.roleId}`).setStyle(ButtonStyle.Secondary).setLabel(o.label.slice(0, 80));
      if (o.emoji) b.setEmoji(o.emoji);
      return b;
    });
    for (let i = 0; i < buttons.length; i += 5) panel.row(...buttons.slice(i, i + 5));
  } else if (menu.mode === 'select') {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`roles:select:${menu.menuId}`)
      .setPlaceholder(t('roles.menu.placeholder'))
      .setMinValues(0)
      .setMaxValues(menu.exclusive ? 1 : menu.options.length)
      .addOptions(
        menu.options.slice(0, 25).map((o) => {
          const opt = new StringSelectMenuOptionBuilder().setValue(o.roleId).setLabel(o.label.slice(0, 100));
          if (o.description) opt.setDescription(o.description.slice(0, 100));
          if (o.emoji) opt.setEmoji(o.emoji);
          return opt;
        }),
      );
    panel.row(select);
  }
  return panel;
}

/** Posts the menu, or edits it in place when it was posted before. Reaction menus get their reactions added. */
export async function publishMenu(bot: Bot, guild: Guild, menu: RoleMenuDoc, channelId?: string): Promise<string> {
  const targetId = channelId ?? menu.channelId;
  const channel = targetId ? guild.channels.cache.get(targetId) : null;
  if (!channel?.isSendable()) throw new UserError('tickets.errors.panelChannel');
  if (menu.options.length === 0) throw new UserError('roles.errors.empty');
  const message = (await renderMenu(bot, guild, menu)).render();

  let posted = menu.messageId && menu.channelId === channel.id ? await channel.messages.fetch(menu.messageId).catch(() => null) : null;
  try {
    if (posted) await posted.edit(message);
    else posted = await channel.send({ ...message, allowedMentions: { parse: [] } });
    if (menu.mode === 'reactions') {
      for (const option of menu.options) if (option.emoji) await posted.react(option.emoji);
      reactionMenus.add(posted.id);
    }
  } catch (err) {
    bot.logger.warn({ err, guild: guild.id, menu: menu.menuId }, 'could not post role menu');
    throw new UserError('roles.errors.invalid');
  }
  await RoleMenuModel.updateOne({ guildId: guild.id, menuId: menu.menuId }, { channelId: channel.id, messageId: posted.id });
  return posted.url;
}

export async function refreshMenu(bot: Bot, guild: Guild, menuId: number): Promise<void> {
  const menu = await RoleMenuModel.findOne({ guildId: guild.id, menuId }).lean<RoleMenuDoc>();
  if (menu?.messageId && menu.options.length > 0) await publishMenu(bot, guild, menu).catch(() => undefined);
}

function describeChanges(t: (key: string, vars: Record<string, string>) => string, changes: { add: string[]; remove: string[] }): string {
  const parts = [];
  if (changes.add.length) parts.push(t('roles.menu.added', { roles: changes.add.map(roleMention).join(', ') }));
  if (changes.remove.length) parts.push(t('roles.menu.removed', { roles: changes.remove.map(roleMention).join(', ') }));
  return parts.join('\n') || t('roles.menu.unchanged', {});
}

export async function reactionToggle(bot: Bot, member: GuildMember, messageId: string, emoji: { id: string | null; name: string | null }, added: boolean): Promise<void> {
  const menu = await RoleMenuModel.findOne({ guildId: member.guild.id, messageId }).lean<RoleMenuDoc>();
  if (!menu) return;
  const key = reactionKey(emoji);
  const option = menu.options.find((o) => o.emoji && emojiKey(o.emoji) === key);
  if (!option) return;
  const held = new Set(member.roles.cache.keys());
  // Adding a reaction always means "give", removing it always means "take".
  if (added === held.has(option.roleId)) return;
  const changes = toggleRoles(held, menu.options.map((o) => o.roleId), option.roleId, menu.exclusive);
  await applyRoles(member, changes, `role menu #${menu.menuId}`);
}

export const menuComponents = [
  defineComponent({
    kind: 'button',
    id: 'roles:toggle',
    defer: 'ephemeral',
    async run(ctx, [menuId, roleId]) {
      const menu = await findMenu(ctx.guild.id, Number(menuId));
      if (!menu.options.some((o) => o.roleId === roleId)) throw new UserError('errors.expired');
      const held = new Set(ctx.member.roles.cache.keys());
      const applied = await applyRoles(ctx.member, toggleRoles(held, menu.options.map((o) => o.roleId), roleId!, menu.exclusive), `role menu #${menu.menuId}`);
      await ctx.respond(ctx.successPanel(describeChanges((k, v) => ctx.t(k, v), applied)));
    },
  }),
  defineComponent({
    kind: 'select',
    id: 'roles:select',
    defer: false,
    async run(ctx, [menuId]) {
      const menu = await findMenu(ctx.guild.id, Number(menuId));
      // Re-rendering resets the menu, otherwise it keeps showing this member's picks to them.
      await ctx.interaction.update((await renderMenu(ctx.bot, ctx.guild, menu)).render());
      ctx.deferMode = 'update';
      const held = new Set(ctx.member.roles.cache.keys());
      const applied = await applyRoles(ctx.member, selectRoles(held, menu.options.map((o) => o.roleId), ctx.interaction.values), `role menu #${menu.menuId}`);
      await ctx.whisper(ctx.successPanel(describeChanges((k, v) => ctx.t(k, v), applied)));
    },
  }),
];
