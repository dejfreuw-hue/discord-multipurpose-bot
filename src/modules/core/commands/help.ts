import {
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type APIApplicationCommandOption,
} from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import type { InteractionContext } from '../../../core/context.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand, defineComponent, type Command, type Module } from '../../../core/module.js';
import { permissionLabel } from '../../../core/permissions.js';
import { coreConfig } from '../config.js';

interface CommandEntry {
  path: string;
  description: string;
  options: APIApplicationCommandOption[];
  command: Command;
}

function describe(bot: Bot, locale: string, key: string): string {
  return bot.i18n.hasKey(key) ? bot.i18n.t(locale, key) : key;
}

/** Commands of a module with subcommands flattened out, so "/case view" gets its own line. */
function entriesOf(mod: Module): CommandEntry[] {
  const entries: CommandEntry[] = [];
  for (const command of mod.commands ?? []) {
    const json = command.data.toJSON() as { name: string; description: string; options?: APIApplicationCommandOption[] };
    const subs = (json.options ?? []).filter(
      (o) => o.type === ApplicationCommandOptionType.Subcommand || o.type === ApplicationCommandOptionType.SubcommandGroup,
    );
    if (subs.length === 0) {
      entries.push({ path: json.name, description: json.description, options: json.options ?? [], command });
      continue;
    }
    for (const sub of subs) {
      if (sub.type === ApplicationCommandOptionType.SubcommandGroup) {
        for (const inner of sub.options ?? []) {
          entries.push({ path: `${json.name} ${sub.name} ${inner.name}`, description: inner.description, options: inner.options ?? [], command });
        }
      } else if (sub.type === ApplicationCommandOptionType.Subcommand) {
        entries.push({ path: `${json.name} ${sub.name}`, description: sub.description, options: sub.options ?? [], command });
      }
    }
  }
  return entries;
}

function visibleModules(ctx: InteractionContext): Module[] {
  const { bot } = ctx;
  const { showDisabled } = bot.moduleConfig({ name: 'core', config: coreConfig }).help;
  return bot.modules.filter((mod) => {
    if (!mod.commands?.some((c) => !c.permissions?.owner || bot.isOwner(ctx.interaction.user.id))) return false;
    return showDisabled || bot.isEnabled(mod.name, ctx.settings);
  });
}

function categoryMenu(ctx: InteractionContext, selected?: string): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
    .setCustomId(`help:category:${ctx.interaction.user.id}`)
    .setPlaceholder(ctx.t('core.help.pick'))
    .addOptions(
      visibleModules(ctx)
        .slice(0, 25)
        .map((mod) =>
          new StringSelectMenuOptionBuilder()
            .setValue(mod.name)
            .setLabel(ctx.t(`modules.${mod.name}.name`).slice(0, 100))
            .setDescription(ctx.t(`modules.${mod.name}.description`).slice(0, 100))
            .setDefault(mod.name === selected),
        ),
    );
}

function overview(ctx: InteractionContext) {
  const { bot } = ctx;
  const modules = visibleModules(ctx);
  return ctx
    .panel()
    .title(ctx.t('core.help.title', { name: bot.config.bot.name }))
    .thumbnail(ctx.interaction.client.user.displayAvatarURL({ size: 128 }))
    .text(ctx.t('core.help.intro', { help: bot.commandMention('help'), setup: bot.commandMention('setup') }))
    .fields(
      modules.map((mod) => ({
        name: ctx.t(`modules.${mod.name}.name`),
        value: `${ctx.t(`modules.${mod.name}.description`)}\n-# ${ctx.t('core.help.commandCount', { count: entriesOf(mod).length })}`,
        inline: true,
      })),
    )
    .row(categoryMenu(ctx));
}

function category(ctx: InteractionContext, mod: Module) {
  const { bot } = ctx;
  const lines = entriesOf(mod)
    .filter((e) => !e.command.permissions?.owner || bot.isOwner(ctx.interaction.user.id))
    .map((e) => `${bot.commandMention(e.path)}\n${describe(bot, ctx.locale, e.description)}`);
  const disabled = !bot.isEnabled(mod.name, ctx.settings);

  return ctx
    .panel()
    .title(ctx.t(`modules.${mod.name}.name`))
    .text(disabled && ctx.t('core.help.disabledHere'), ctx.t(`modules.${mod.name}.description`))
    .divider()
    .text(lines.join('\n\n'))
    .row(categoryMenu(ctx, mod.name))
    .row(
      new ButtonBuilder()
        .setCustomId(`help:home:${ctx.interaction.user.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(ctx.t('core.help.back')),
    );
}

function commandDetail(ctx: InteractionContext, name: string) {
  const { bot } = ctx;
  const entry = bot.commands.get(name);
  if (!entry) throw new UserError('core.help.notFound', { name });
  const { item: command, module } = entry;

  const usage = entriesOf({ ...module, commands: [command] }).map((e) => {
    const args = e.options.map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ');
    return `${bot.commandMention(e.path)} ${args ? `\`${args}\`` : ''}\n${describe(bot, ctx.locale, e.description)}`;
  });

  const needs: string[] = [];
  if (command.permissions?.user) needs.push(...new PermissionsBitField(command.permissions.user).toArray().map(permissionLabel));
  if (command.permissions?.staff) needs.push(ctx.t('core.help.staffRole'));
  if (command.permissions?.owner) needs.push(ctx.t('core.help.ownerOnly'));
  const cooldown = bot.config.commands.cooldowns[name] ?? command.cooldown ?? bot.config.commands.defaultCooldown;

  return ctx
    .panel()
    .title(`/${name}`)
    .text(usage.join('\n\n'))
    .fields([
      { name: ctx.t('core.help.category'), value: ctx.t(`modules.${module.name}.name`), inline: true },
      { name: ctx.t('core.help.cooldown'), value: ctx.t('core.help.seconds', { count: cooldown }), inline: true },
      { name: ctx.t('core.help.requires'), value: needs.length > 0 ? needs.join(', ') : ctx.t('common.none'), inline: true },
    ])
    .footer(ctx.t('core.help.legend'));
}

export const helpCategory = defineComponent({
  kind: 'select',
  id: 'help:category',
  async run(ctx, [owner]) {
    if (owner !== ctx.interaction.user.id) throw new UserError('core.help.notYours');
    const mod = ctx.bot.modules.find((m) => m.name === ctx.interaction.values[0]);
    await ctx.update(mod ? category(ctx, mod) : overview(ctx));
  },
});

export const helpHome = defineComponent({
  kind: 'button',
  id: 'help:home',
  async run(ctx, [owner]) {
    if (owner !== ctx.interaction.user.id) throw new UserError('core.help.notYours');
    await ctx.update(overview(ctx));
  },
});

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('core.help.description')
    .addStringOption((o) => o.setName('command').setDescription('core.help.options.command').setAutocomplete(true)),
  defer: 'public',
  async run(ctx) {
    const name = ctx.interaction.options.getString('command');
    await ctx.respond(name ? commandDetail(ctx, name.replace(/^\//, '').split(' ')[0]!) : overview(ctx));
  },
  async autocomplete(interaction, bot) {
    const typed = interaction.options.getFocused().toLowerCase().replace(/^\//, '');
    const choices = [...bot.commands.keys()]
      .filter((name) => name.includes(typed))
      .sort()
      .slice(0, 25)
      .map((name) => ({ name: `/${name}`, value: name }));
    await interaction.respond(choices);
  },
});
