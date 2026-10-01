import {
  ChannelType,
  PermissionFlagsBits,
  roleMention,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type SlashCommandIntegerOption,
} from 'discord.js';
import { emojiKey } from '../../../core/emoji.js';
import { UserError } from '../../../core/errors.js';
import { nextSequence } from '../../../core/models/counter.js';
import { defineCommand } from '../../../core/module.js';
import { assertAssignableRole } from '../../../core/permissions.js';
import { findMenu, publishMenu, reactionMenus, refreshMenu } from './menus.js';
import { RoleMenuModel, type RoleMenuDoc } from './model.js';
import { rolesSettings } from './settings.js';

const MAX_AUTO = 10;
const MAX_MENUS = 25;
const MAX_OPTIONS = 25;
const MANAGE_ROLES = PermissionFlagsBits.ManageRoles;

export const autorole = defineCommand({
  data: new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('roles.autorole.description')
    .setDefaultMemberPermissions(MANAGE_ROLES)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('roles.autorole.add')
        .addRoleOption((o) => o.setName('role').setDescription('roles.options.role').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('for')
            .setDescription('roles.autorole.options.for')
            .addChoices({ name: 'roles.autorole.humans', value: 'humans' }, { name: 'roles.autorole.bots', value: 'bots' }),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('roles.autorole.remove')
        .addRoleOption((o) => o.setName('role').setDescription('roles.options.role').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('roles.autorole.list')),
  defer: 'ephemeral',
  permissions: { user: MANAGE_ROLES, bot: MANAGE_ROLES },
  async run(ctx) {
    const { options } = ctx.interaction;
    const sub = options.getSubcommand();
    const s = await ctx.bot.settings.module(ctx.guild.id, rolesSettings);

    if (sub === 'add') {
      const role = options.getRole('role', true);
      await assertAssignableRole(ctx.guild.roles.cache.get(role.id)!, ctx.member);
      const key = options.getString('for') === 'bots' ? 'botRoles' : 'humanRoles';
      if (s[key].length >= MAX_AUTO) throw new UserError('ai.errors.listFull', { max: MAX_AUTO });
      await ctx.bot.settings.updateModule(ctx.guild.id, rolesSettings, { [key]: [...new Set([...s[key], role.id])] });
    } else if (sub === 'remove') {
      const id = options.getRole('role', true).id;
      await ctx.bot.settings.updateModule(ctx.guild.id, rolesSettings, {
        humanRoles: s.humanRoles.filter((r) => r !== id),
        botRoles: s.botRoles.filter((r) => r !== id),
      });
    }
    const updated = await ctx.bot.settings.module(ctx.guild.id, rolesSettings);
    const list = (ids: string[]) => ids.map(roleMention).join(', ') || ctx.t('common.none');
    await ctx.respond(
      ctx
        .panel()
        .title(ctx.t('roles.autorole.title'))
        .fields([
          { name: ctx.t('roles.autorole.humans'), value: list(updated.humanRoles) },
          { name: ctx.t('roles.autorole.bots'), value: list(updated.botRoles) },
        ])
        .footer(ctx.t('roles.autorole.footer')),
    );
  },
});

async function menuAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guildId) return interaction.respond([]);
  const typed = String(interaction.options.getFocused()).toLowerCase();
  const menus = await RoleMenuModel.find({ guildId: interaction.guildId }).sort({ menuId: 1 }).lean<RoleMenuDoc[]>();
  await interaction.respond(
    menus
      .filter((m) => `${m.menuId} ${m.title}`.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((m) => ({ name: `#${m.menuId} ${m.title} (${m.options.length})`.slice(0, 100), value: m.menuId })),
  );
}

const menuOption = (o: SlashCommandIntegerOption) =>
  o.setName('menu').setDescription('roles.options.menu').setRequired(true).setAutocomplete(true);

export const rolemenu = defineCommand({
  data: new SlashCommandBuilder()
    .setName('rolemenu')
    .setDescription('roles.menuCommand.description')
    .setDefaultMemberPermissions(MANAGE_ROLES)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('roles.menuCommand.create')
        .addStringOption((o) => o.setName('title').setDescription('roles.options.title').setRequired(true).setMaxLength(100))
        .addStringOption((o) =>
          o
            .setName('style')
            .setDescription('roles.options.style')
            .addChoices(
              { name: 'roles.styles.buttons', value: 'buttons' },
              { name: 'roles.styles.select', value: 'select' },
              { name: 'roles.styles.reactions', value: 'reactions' },
            ),
        )
        .addStringOption((o) => o.setName('description').setDescription('roles.options.description').setMaxLength(1000))
        .addBooleanOption((o) => o.setName('exclusive').setDescription('roles.options.exclusive')),
    )
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('roles.menuCommand.add')
        .addIntegerOption(menuOption)
        .addRoleOption((o) => o.setName('role').setDescription('roles.options.role').setRequired(true))
        .addStringOption((o) => o.setName('label').setDescription('roles.options.label').setMaxLength(80))
        .addStringOption((o) => o.setName('emoji').setDescription('roles.options.emoji').setMaxLength(64))
        .addStringOption((o) => o.setName('description').setDescription('roles.options.optionDescription').setMaxLength(100)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('roles.menuCommand.remove')
        .addIntegerOption(menuOption)
        .addRoleOption((o) => o.setName('role').setDescription('roles.options.role').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('send')
        .setDescription('roles.menuCommand.send')
        .addIntegerOption(menuOption)
        .addChannelOption((o) =>
          o.setName('channel').setDescription('roles.options.channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((s) => s.setName('delete').setDescription('roles.menuCommand.delete').addIntegerOption(menuOption))
    .addSubcommand((s) => s.setName('list').setDescription('roles.menuCommand.list')),
  defer: 'ephemeral',
  permissions: { user: MANAGE_ROLES, bot: MANAGE_ROLES },
  autocomplete: menuAutocomplete,
  async run(ctx) {
    const { options } = ctx.interaction;
    const sub = options.getSubcommand();
    const guildId = ctx.guild.id;

    if (sub === 'list') {
      const menus = await RoleMenuModel.find({ guildId }).sort({ menuId: 1 }).lean<RoleMenuDoc[]>();
      const lines = menus.map(
        (m) =>
          `**#${m.menuId} ${m.title}** · ${ctx.t(`roles.styles.${m.mode}`)} · ${m.channelId ? `<#${m.channelId}>` : ctx.t('tickets.panel.notPosted')}\n${
            m.options.map((o) => roleMention(o.roleId)).join(' ') || ctx.t('common.none')
          }`,
      );
      await ctx.respond(ctx.panel().title(ctx.t('roles.menuCommand.listTitle')).text(lines.join('\n\n') || ctx.t('roles.menuCommand.none')));
      return;
    }
    if (sub === 'create') {
      if ((await RoleMenuModel.countDocuments({ guildId })) >= MAX_MENUS) throw new UserError('ai.errors.listFull', { max: MAX_MENUS });
      const menuId = await nextSequence(`rolemenu:${guildId}`);
      await RoleMenuModel.create({
        guildId,
        menuId,
        title: options.getString('title', true),
        description: options.getString('description') ?? '',
        mode: (options.getString('style') as RoleMenuDoc['mode'] | null) ?? 'buttons',
        exclusive: options.getBoolean('exclusive') ?? false,
      });
      await ctx.respond(ctx.successPanel(ctx.t('roles.menuCommand.created', { id: menuId, command: ctx.bot.commandMention('rolemenu add') })));
      return;
    }

    const menu = await findMenu(guildId, options.getInteger('menu', true));
    if (sub === 'add') {
      const role = ctx.guild.roles.cache.get(options.getRole('role', true).id)!;
      await assertAssignableRole(role, ctx.member);
      const emoji = options.getString('emoji')?.trim() || null;
      if (menu.mode === 'reactions' && !emoji) throw new UserError('roles.errors.needEmoji');
      if (emoji && menu.options.some((o) => o.emoji && emojiKey(o.emoji) === emojiKey(emoji) && o.roleId !== role.id)) throw new UserError('roles.errors.emojiTaken');
      const others = menu.options.filter((o) => o.roleId !== role.id);
      if (others.length >= MAX_OPTIONS) throw new UserError('ai.errors.listFull', { max: MAX_OPTIONS });
      const option = { roleId: role.id, label: options.getString('label') ?? role.name, emoji, description: options.getString('description') };
      await RoleMenuModel.updateOne({ guildId, menuId: menu.menuId }, { options: [...others, option] });
      await refreshMenu(ctx.bot, ctx.guild, menu.menuId);
      await ctx.respond(ctx.successPanel(ctx.t('roles.menuCommand.added', { role: role.toString(), id: menu.menuId })));
    } else if (sub === 'remove') {
      const id = options.getRole('role', true).id;
      await RoleMenuModel.updateOne({ guildId, menuId: menu.menuId }, { options: menu.options.filter((o) => o.roleId !== id) });
      await refreshMenu(ctx.bot, ctx.guild, menu.menuId);
      await ctx.respond(ctx.successPanel(ctx.t('roles.menuCommand.removed', { role: roleMention(id) })));
    } else if (sub === 'send') {
      const url = await publishMenu(ctx.bot, ctx.guild, menu, options.getChannel('channel', true).id);
      await ctx.respond(ctx.successPanel(ctx.t('tickets.panel.sent', { url })));
    } else if (sub === 'delete') {
      await RoleMenuModel.deleteOne({ guildId, menuId: menu.menuId });
      if (menu.messageId) {
        reactionMenus.delete(menu.messageId);
        const channel = menu.channelId ? ctx.guild.channels.cache.get(menu.channelId) : null;
        if (channel?.isTextBased()) await channel.messages.delete(menu.messageId).catch(() => undefined);
      }
      await ctx.respond(ctx.successPanel(ctx.t('roles.menuCommand.deleted', { id: menu.menuId })));
    }
  },
});
