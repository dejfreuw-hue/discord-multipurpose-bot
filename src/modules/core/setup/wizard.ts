import {
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  roleMention,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { GuildContext } from '../../../core/context.js';
import { UserError } from '../../../core/errors.js';
import { defineComponent, type Module, type SetupStep } from '../../../core/module.js';
import type { Panel, PanelRow } from '../../../core/ui/panel.js';

const MANAGE = { user: PermissionFlagsBits.ManageGuild };
const MAX_STAFF_ROLES = 10;

function row(...components: MessageActionRowComponentBuilder[]): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(components);
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0').toUpperCase()}`;
}

function toggleableModules(ctx: GuildContext): Module[] {
  return ctx.bot.modules.filter((m) => m.toggleable);
}

export const coreSteps: SetupStep[] = [
  {
    id: 'language',
    async render(ctx) {
      const current = ctx.bot.i18n.list().find((l) => l.code === ctx.locale);
      const menu = new StringSelectMenuBuilder()
        .setCustomId('setup:locale')
        .addOptions(
          ctx.bot.i18n
            .list()
            .slice(0, 25)
            .map((l) => new StringSelectMenuOptionBuilder().setValue(l.code).setLabel(l.name).setDefault(l.code === ctx.locale)),
        );
      return { text: ctx.t('core.setup.language.body', { current: current?.name ?? ctx.locale }), rows: [row(menu)] };
    },
  },
  {
    id: 'staff',
    async render(ctx) {
      const roles = ctx.settings.staffRoles;
      const menu = new RoleSelectMenuBuilder()
        .setCustomId('setup:staff')
        .setPlaceholder(ctx.t('core.setup.staff.placeholder'))
        .setMinValues(0)
        .setMaxValues(MAX_STAFF_ROLES)
        .setDefaultRoles(roles);
      const current = roles.length > 0 ? roles.map(roleMention).join(', ') : ctx.t('core.setup.staff.none');
      return { text: ctx.t('core.setup.staff.body', { current }), rows: [row(menu)] };
    },
  },
  {
    id: 'appearance',
    async render(ctx) {
      const custom = ctx.settings.color !== null;
      return {
        text: ctx.t('core.setup.appearance.body', {
          current: hex(ctx.color),
          source: ctx.t(custom ? 'core.setup.appearance.custom' : 'core.setup.appearance.default'),
        }),
        rows: [
          row(
            new ButtonBuilder().setCustomId('setup:color').setStyle(ButtonStyle.Primary).setLabel(ctx.t('core.setup.appearance.change')),
            new ButtonBuilder()
              .setCustomId('setup:color-reset')
              .setStyle(ButtonStyle.Secondary)
              .setLabel(ctx.t('core.setup.appearance.reset'))
              .setDisabled(!custom),
          ),
        ],
      };
    },
  },
  {
    id: 'modules',
    async render(ctx) {
      const modules = toggleableModules(ctx);
      if (modules.length === 0) return { text: ctx.t('core.setup.modules.empty'), rows: [] };

      const state = modules.map((m) => {
        const on = ctx.bot.isEnabled(m.name, ctx.settings);
        return `**${ctx.t(`modules.${m.name}.name`)}**: ${ctx.t(on ? 'common.enabled' : 'common.disabled')}`;
      });
      const menu = new StringSelectMenuBuilder()
        .setCustomId('setup:modules')
        .setPlaceholder(ctx.t('core.setup.modules.placeholder'))
        .setMinValues(0)
        .setMaxValues(Math.min(modules.length, 25))
        .addOptions(
          modules.slice(0, 25).map((m) =>
            new StringSelectMenuOptionBuilder()
              .setValue(m.name)
              .setLabel(ctx.t(`modules.${m.name}.name`))
              .setDescription(ctx.t(`modules.${m.name}.description`).slice(0, 100))
              .setDefault(ctx.bot.isEnabled(m.name, ctx.settings)),
          ),
        );
      return { text: `${ctx.t('core.setup.modules.body')}\n\n${state.join('\n')}`, rows: [row(menu)] };
    },
  },
];

interface WizardStep {
  key: string;
  module: Module;
  step: SetupStep;
}

function wizardSteps(ctx: GuildContext): WizardStep[] {
  const steps: WizardStep[] = [];
  for (const mod of ctx.bot.modules) {
    if (!ctx.bot.isEnabled(mod.name, ctx.settings)) continue;
    for (const step of mod.setup ?? []) steps.push({ key: `${mod.name}.${step.id}`, module: mod, step });
  }
  return steps;
}

/** Renders one page of the wizard. Unknown keys (a module was just disabled) fall back to the first page. */
export async function renderWizard(ctx: GuildContext, key?: string): Promise<Panel> {
  const steps = wizardSteps(ctx);
  const index = Math.max(0, steps.findIndex((s) => s.key === key));
  const current = steps[index]!;
  const view = await current.step.render(ctx);

  const previous = steps[index - 1];
  const next = steps[index + 1];
  const nav = row(
    new ButtonBuilder()
      .setCustomId(`setup:go:${previous?.key ?? current.key}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(ctx.t('core.setup.back'))
      .setDisabled(!previous),
    next
      ? new ButtonBuilder().setCustomId(`setup:go:${next.key}`).setStyle(ButtonStyle.Primary).setLabel(ctx.t('core.setup.next'))
      : new ButtonBuilder().setCustomId('setup:finish').setStyle(ButtonStyle.Success).setLabel(ctx.t('core.setup.finish')),
  );

  const panel = ctx
    .panel()
    .title(ctx.t('core.setup.title'))
    .text(`-# ${ctx.t('core.setup.progress', { current: index + 1, total: steps.length })}`)
    .text(`### ${ctx.t(`${current.module.name}.setup.${current.step.id}.title`)}`, view.text);
  for (const r of view.rows) panel.row(...r.components);
  return panel.row(...nav.components);
}

async function summary(ctx: GuildContext): Promise<Panel> {
  const s = ctx.settings;
  const language = ctx.bot.i18n.list().find((l) => l.code === ctx.locale)?.name ?? ctx.locale;
  const enabled = toggleableModules(ctx)
    .filter((m) => ctx.bot.isEnabled(m.name, s))
    .map((m) => ctx.t(`modules.${m.name}.name`));
  return ctx
    .successPanel(ctx.t('core.setup.done.body', { setup: ctx.bot.commandMention('setup') }))
    .title(ctx.t('core.setup.done.title'))
    .fields([
      { name: ctx.t('core.setup.language.title'), value: language, inline: true },
      { name: ctx.t('core.setup.appearance.title'), value: hex(ctx.color), inline: true },
      { name: ctx.t('core.setup.staff.title'), value: s.staffRoles.map(roleMention).join(', ') || ctx.t('common.none') },
      { name: ctx.t('core.setup.modules.title'), value: enabled.join(', ') || ctx.t('common.none') },
    ]);
}

export const setupComponents = [
  defineComponent({
    kind: 'button',
    id: 'setup:go',
    permissions: MANAGE,
    async run(ctx, [key]) {
      await ctx.update(await renderWizard(ctx, key));
    },
  }),
  defineComponent({
    kind: 'button',
    id: 'setup:finish',
    permissions: MANAGE,
    async run(ctx) {
      await ctx.update(await summary(ctx));
    },
  }),
  defineComponent({
    kind: 'select',
    id: 'setup:locale',
    permissions: MANAGE,
    async run(ctx) {
      const code = ctx.interaction.values[0];
      if (!code || !ctx.bot.i18n.has(code)) throw new UserError('core.setup.language.unknown');
      ctx.settings = await ctx.bot.settings.update(ctx.guild.id, { locale: code });
      await ctx.update(await renderWizard(ctx, 'core.language'));
    },
  }),
  defineComponent({
    kind: 'select',
    id: 'setup:staff',
    permissions: MANAGE,
    async run(ctx) {
      // @everyone and bot-managed roles can be picked in the menu but make no sense as staff.
      const roles = ctx.interaction.values.filter((id) => {
        const role = ctx.guild.roles.cache.get(id);
        return role && role.id !== ctx.guild.id && !role.managed;
      });
      ctx.settings = await ctx.bot.settings.update(ctx.guild.id, { staffRoles: roles });
      await ctx.update(await renderWizard(ctx, 'core.staff'));
    },
  }),
  defineComponent({
    kind: 'button',
    id: 'setup:color',
    permissions: MANAGE,
    defer: false,
    async run(ctx) {
      const input = new TextInputBuilder()
        .setCustomId('hex')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('#5865F2')
        .setMinLength(6)
        .setMaxLength(7)
        .setRequired(true)
        .setValue(hex(ctx.color));
      const modal = new ModalBuilder()
        .setCustomId('setup:color')
        .setTitle(ctx.t('core.setup.appearance.modalTitle'))
        .addLabelComponents(new LabelBuilder().setLabel(ctx.t('core.setup.appearance.modalLabel')).setTextInputComponent(input));
      await ctx.interaction.showModal(modal);
    },
  }),
  defineComponent({
    kind: 'modal',
    id: 'setup:color',
    permissions: MANAGE,
    async run(ctx) {
      const value = ctx.interaction.fields.getTextInputValue('hex').trim();
      if (!/^#?[0-9a-f]{6}$/i.test(value)) throw new UserError('core.setup.appearance.invalid', { value });
      ctx.settings = await ctx.bot.settings.update(ctx.guild.id, { color: Number.parseInt(value.replace('#', ''), 16) });
      await ctx.update(await renderWizard(ctx, 'core.appearance'));
    },
  }),
  defineComponent({
    kind: 'button',
    id: 'setup:color-reset',
    permissions: MANAGE,
    async run(ctx) {
      ctx.settings = await ctx.bot.settings.update(ctx.guild.id, { color: null });
      await ctx.update(await renderWizard(ctx, 'core.appearance'));
    },
  }),
  defineComponent({
    kind: 'select',
    id: 'setup:modules',
    permissions: MANAGE,
    async run(ctx) {
      const selected = new Set(ctx.interaction.values);
      const toggleable = toggleableModules(ctx).map((m) => m.name);
      // Keep entries for modules that are switched off globally right now, so turning them
      // back on in config.yml doesn't silently re-enable them in this server.
      const kept = ctx.settings.disabledModules.filter((name) => !toggleable.includes(name));
      const disabled = [...kept, ...toggleable.filter((name) => !selected.has(name))];
      ctx.settings = await ctx.bot.settings.update(ctx.guild.id, { disabledModules: disabled });
      await ctx.update(await renderWizard(ctx, 'core.modules'));
    },
  }),
];
