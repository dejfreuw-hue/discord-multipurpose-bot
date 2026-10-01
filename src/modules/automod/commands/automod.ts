import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  time,
  TimestampStyles,
  type SlashCommandStringOption,
} from 'discord.js';
import type { CommandContext } from '../../../core/context.js';
import { formatDuration, parseDuration } from '../../../core/duration.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand, defineComponent } from '../../../core/module.js';
import { describeStep } from '../enforce.js';
import { automodSettings, FILTERS, PUNISHMENTS, type AutomodSettings, type FilterName } from '../settings.js';
import { activeStrikes, clearStrikes, strikeBreakdown } from '../strikes.js';
import { filterSummary, statusPanel } from '../summary.js';

const MAX_WORDS = 500;
const MAX_DOMAINS = 100;
const MAX_STEPS = 10;
const MIN_DECAY = 60_000;
const MAX_DECAY = 90 * 24 * 60 * 60 * 1000;

/** Numeric settings each filter exposes in its configure modal, besides strikes. */
const NUMBER_FIELDS: Record<FilterName, { key: string; min: number; max: number }[]> = {
  invites: [],
  links: [],
  badWords: [],
  spam: [
    { key: 'messages', min: 2, max: 50 },
    { key: 'seconds', min: 1, max: 120 },
    { key: 'duplicates', min: 2, max: 50 },
  ],
  mentions: [{ key: 'limit', min: 2, max: 50 }],
  caps: [
    { key: 'percent', min: 50, max: 100 },
    { key: 'minLength', min: 4, max: 500 },
  ],
  ghostPing: [{ key: 'seconds', min: 5, max: 600 }],
};

const filterOption = (o: SlashCommandStringOption) =>
  o
    .setName('filter')
    .setDescription('automod.options.filter')
    .setRequired(true)
    .addChoices(...FILTERS.map((name) => ({ name: `automod.filters.${name}`, value: name })));

function asFilter(value: string): FilterName {
  if (!FILTERS.includes(value as FilterName)) throw new UserError('errors.expired');
  return value as FilterName;
}

function splitList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

function cleanDomain(raw: string): string {
  return raw
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]!;
}

async function save(ctx: CommandContext<true>, patch: Partial<AutomodSettings>): Promise<AutomodSettings> {
  return ctx.bot.settings.updateModule(ctx.guild.id, automodSettings, patch);
}

function withFilter<K extends FilterName>(settings: AutomodSettings, name: K, patch: Partial<AutomodSettings['filters'][K]>) {
  return { filters: { ...settings.filters, [name]: { ...settings.filters[name], ...patch } } };
}

function configureModal(ctx: CommandContext<true>, name: FilterName, settings: AutomodSettings): ModalBuilder {
  const current = settings.filters[name] as Record<string, unknown>;
  const numberInput = (key: string, label: string, value: number) =>
    new LabelBuilder()
      .setLabel(label)
      .setTextInputComponent(new TextInputBuilder().setCustomId(key).setStyle(TextInputStyle.Short).setValue(String(value)).setMaxLength(4));

  const modal = new ModalBuilder()
    .setCustomId(`automod:configure:${name}`)
    .setTitle(ctx.t('automod.configure.title', { filter: ctx.t(`automod.filters.${name}`) }).slice(0, 45))
    .addLabelComponents(numberInput('strikes', ctx.t('automod.fields.strikes'), current.strikes as number));
  for (const field of NUMBER_FIELDS[name]) {
    modal.addLabelComponents(
      numberInput(field.key, ctx.t(`automod.fields.${field.key}`, { min: field.min, max: field.max }), current[field.key] as number),
    );
  }
  if (name === 'invites') {
    const own = settings.filters.invites.allowOwnServer;
    modal.addLabelComponents(
      new LabelBuilder().setLabel(ctx.t('automod.fields.allowOwnServer')).setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId('allowOwnServer')
          .addOptions(
            { label: ctx.t('common.on'), value: 'on', default: own },
            { label: ctx.t('common.off'), value: 'off', default: !own },
          ),
      ),
    );
  }
  return modal;
}

export const configureSubmit = defineComponent({
  kind: 'modal',
  id: 'automod:configure',
  defer: 'ephemeral',
  permissions: { user: PermissionFlagsBits.ManageGuild },
  async run(ctx, [raw]) {
    const name = asFilter(raw ?? '');
    const fields = ctx.interaction.fields;
    const readNumber = (key: string, min: number, max: number) => {
      const value = Number(fields.getTextInputValue(key).trim());
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new UserError('automod.errors.number', { field: ctx.t(`automod.fields.${key}`, { min, max }), min, max });
      }
      return value;
    };

    const patch: Record<string, unknown> = { strikes: readNumber('strikes', 0, 10) };
    for (const field of NUMBER_FIELDS[name]) patch[field.key] = readNumber(field.key, field.min, field.max);
    if (name === 'invites') patch.allowOwnServer = fields.getStringSelectValues('allowOwnServer')[0] !== 'off';

    const current = await ctx.bot.settings.module(ctx.guild.id, automodSettings);
    const updated = await ctx.bot.settings.updateModule(ctx.guild.id, automodSettings, withFilter(current, name, patch));
    await ctx.respond(ctx.successPanel(filterSummary(ctx, name, updated)));
  },
});

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('automod.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('status').setDescription('automod.status.description'))
    .addSubcommand((s) =>
      s
        .setName('toggle')
        .setDescription('automod.toggle.description')
        .addStringOption(filterOption)
        .addBooleanOption((o) => o.setName('enabled').setDescription('automod.toggle.options.enabled').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('configure').setDescription('automod.configure.description').addStringOption(filterOption))
    .addSubcommand((s) =>
      s
        .setName('decay')
        .setDescription('automod.decay.description')
        .addStringOption((o) => o.setName('duration').setDescription('automod.decay.options.duration').setRequired(true).setMaxLength(32)),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('words')
        .setDescription('automod.words.description')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('automod.words.add')
            .addStringOption((o) => o.setName('words').setDescription('automod.words.options.words').setRequired(true).setMaxLength(1000)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('automod.words.remove')
            .addStringOption((o) => o.setName('words').setDescription('automod.words.options.words').setRequired(true).setMaxLength(1000)),
        )
        .addSubcommand((s) => s.setName('list').setDescription('automod.words.list')),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('domains')
        .setDescription('automod.domains.description')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('automod.domains.add')
            .addStringOption((o) => o.setName('domains').setDescription('automod.domains.options.domains').setRequired(true).setMaxLength(1000)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('automod.domains.remove')
            .addStringOption((o) => o.setName('domains').setDescription('automod.domains.options.domains').setRequired(true).setMaxLength(1000)),
        )
        .addSubcommand((s) => s.setName('list').setDescription('automod.domains.list')),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('punishment')
        .setDescription('automod.punishment.description')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('automod.punishment.add')
            .addIntegerOption((o) => o.setName('strikes').setDescription('automod.punishment.options.strikes').setRequired(true).setMinValue(1).setMaxValue(100))
            .addStringOption((o) =>
              o
                .setName('action')
                .setDescription('automod.punishment.options.action')
                .setRequired(true)
                .addChoices(...PUNISHMENTS.map((p) => ({ name: `automod.actions.${p}`, value: p }))),
            )
            .addStringOption((o) => o.setName('duration').setDescription('automod.punishment.options.duration').setMaxLength(32)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('automod.punishment.remove')
            .addIntegerOption((o) => o.setName('strikes').setDescription('automod.punishment.options.strikes').setRequired(true).setMinValue(1).setMaxValue(100)),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('strikes')
        .setDescription('automod.strikes.description')
        .addSubcommand((s) =>
          s
            .setName('view')
            .setDescription('automod.strikes.view')
            .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('clear')
            .setDescription('automod.strikes.clear')
            .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true)),
        ),
    ),
  // The configure subcommand opens a modal, which can't follow a deferred reply.
  defer: false,
  permissions: { user: PermissionFlagsBits.ManageGuild },
  async run(ctx) {
    const { options } = ctx.interaction;
    const group = options.getSubcommandGroup();
    const sub = options.getSubcommand();
    const settings = await ctx.bot.settings.module(ctx.guild.id, automodSettings);

    if (sub === 'configure' && !group) {
      await ctx.interaction.showModal(configureModal(ctx, asFilter(options.getString('filter', true)), settings));
      return;
    }
    await ctx.interaction.deferReply({ flags: MessageFlags.Ephemeral });
    ctx.deferMode = 'ephemeral';

    if (!group) {
      if (sub === 'status') return ctx.respond(statusPanel(ctx, settings));
      if (sub === 'toggle') {
        const name = asFilter(options.getString('filter', true));
        const updated = await save(ctx, withFilter(settings, name, { enabled: options.getBoolean('enabled', true) }));
        return ctx.respond(ctx.successPanel(filterSummary(ctx, name, updated)));
      }
      if (sub === 'decay') {
        const raw = options.getString('duration', true);
        const ms = parseDuration(raw);
        if (ms === null || ms < MIN_DECAY || ms > MAX_DECAY) throw new UserError('automod.decay.invalid', { value: raw });
        await save(ctx, { strikeDecay: ms });
        return ctx.respond(ctx.successPanel(ctx.t('automod.decay.done', { duration: formatDuration(ms) })));
      }
    }

    if (group === 'words') {
      const current = settings.filters.badWords.words;
      if (sub === 'list') {
        const text = current.length > 0 ? current.map((w) => `||${w}||`).join(', ') : ctx.t('automod.words.empty');
        return ctx.respond(ctx.panel().title(ctx.t('automod.words.title', { count: current.length })).text(text.slice(0, 3900)));
      }
      const input = splitList(options.getString('words', true)).filter((w) => w.length <= 50);
      const next = sub === 'add' ? [...new Set([...current, ...input])] : current.filter((w) => !input.includes(w));
      if (next.length > MAX_WORDS) throw new UserError('automod.words.tooMany', { max: MAX_WORDS });
      await save(ctx, withFilter(settings, 'badWords', { words: next }));
      const key = settings.filters.badWords.enabled ? 'automod.words.saved' : 'automod.words.savedDisabled';
      return ctx.respond(ctx.successPanel(ctx.t(key, { count: next.length })));
    }

    if (group === 'domains') {
      const current = settings.filters.links.allowedDomains;
      if (sub === 'list') {
        return ctx.respond(
          ctx
            .panel()
            .title(ctx.t('automod.domains.title'))
            .text(current.length > 0 ? current.map((d) => `\`${d}\``).join(', ') : ctx.t('automod.domains.empty')),
        );
      }
      const input = splitList(options.getString('domains', true)).map(cleanDomain).filter((d) => d.includes('.'));
      const next = sub === 'add' ? [...new Set([...current, ...input])] : current.filter((d) => !input.includes(d));
      if (next.length > MAX_DOMAINS) throw new UserError('automod.domains.tooMany', { max: MAX_DOMAINS });
      await save(ctx, withFilter(settings, 'links', { allowedDomains: next }));
      return ctx.respond(ctx.successPanel(ctx.t('automod.domains.saved', { count: next.length })));
    }

    if (group === 'punishment') {
      const strikes = options.getInteger('strikes', true);
      const others = settings.ladder.filter((s) => s.strikes !== strikes);
      if (sub === 'remove') {
        if (others.length === settings.ladder.length) throw new UserError('automod.punishment.notFound', { strikes });
        await save(ctx, { ladder: others });
        return ctx.respond(ctx.successPanel(ctx.t('automod.punishment.removed', { strikes })));
      }

      const action = options.getString('action', true) as (typeof PUNISHMENTS)[number];
      const rawDuration = options.getString('duration');
      const duration = rawDuration ? parseDuration(rawDuration) : null;
      if (rawDuration && duration === null) throw new UserError('moderation.errors.badDuration', { value: rawDuration });
      if (action === 'timeout' && !duration) throw new UserError('automod.punishment.needsDuration');
      if (others.length >= MAX_STEPS) throw new UserError('automod.punishment.tooMany', { max: MAX_STEPS });

      const step = { strikes, action, duration: action === 'timeout' || action === 'ban' ? duration : null };
      await save(ctx, { ladder: [...others, step].sort((a, b) => a.strikes - b.strikes) });
      return ctx.respond(
        ctx.successPanel(ctx.t('automod.punishment.added', { strikes, action: describeStep((k, v) => ctx.t(k, v), step) })),
      );
    }

    if (group === 'strikes') {
      const user = options.getUser('user', true);
      if (sub === 'clear') {
        const removed = await clearStrikes(ctx.guild.id, user.id);
        return ctx.respond(ctx.successPanel(ctx.t('automod.strikes.cleared', { user: user.toString(), count: removed })));
      }
      const [total, entries] = await Promise.all([activeStrikes(ctx.guild.id, user.id), strikeBreakdown(ctx.guild.id, user.id)]);
      const lines = entries.map((e) =>
        ctx.t('automod.strikes.line', {
          filter: ctx.t(`automod.filters.${e.filter}`),
          count: e.points,
          time: time(e.expiresAt, TimestampStyles.RelativeTime),
        }),
      );
      return ctx.respond(
        ctx
          .panel()
          .title(ctx.t('automod.strikes.title'))
          .text(ctx.t('automod.strikes.total', { user: user.toString(), count: total }), lines.join('\n') || null),
      );
    }
  },
});
