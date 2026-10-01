import { randomBytes } from 'node:crypto';
import { ChannelType, channelMention, PermissionFlagsBits, roleMention, SlashCommandBuilder, type AutocompleteInteraction } from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import type { CommandContext } from '../../../core/context.js';
import { UserError } from '../../../core/errors.js';
import { nextSequence } from '../../../core/models/counter.js';
import { defineCommand } from '../../../core/module.js';
import { BUTTON_STYLES, PanelModel, type ButtonStyleName, type PanelDoc, type TicketCategory } from '../models.js';
import { findCategory, findPanel, publishPanel, refreshPanel } from '../panels.js';
import { ticketSettings, type TicketSettings } from '../settings.js';

const MAX_PANELS = 25;
const MAX_CATEGORIES = 25;
const MAX_QUESTIONS = 5;

const SENDABLE = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

async function savePanel(ctx: CommandContext<true>, panel: PanelDoc, patch: Partial<PanelDoc>): Promise<void> {
  await PanelModel.updateOne({ guildId: ctx.guild.id, panelId: panel.panelId }, patch);
  await refreshPanel(ctx.bot, ctx.guild, panel.panelId);
}

function panelSummary(ctx: CommandContext<true>, panel: PanelDoc): string {
  const where = panel.channelId ? channelMention(panel.channelId) : ctx.t('tickets.panel.notPosted');
  const categories = panel.categories
    .map((c) => {
      const extras = [
        c.questions.length > 0 ? ctx.t('tickets.panel.questions', { count: c.questions.length }) : null,
        c.staffRoles.length > 0 ? c.staffRoles.map(roleMention).join(' ') : null,
      ].filter(Boolean);
      return `- ${c.emoji ? `${c.emoji} ` : ''}**${c.label}** \`${c.id}\`${extras.length ? ` · ${extras.join(' · ')}` : ''}`;
    })
    .join('\n');
  return `**#${panel.panelId} ${panel.title}** (${ctx.t(`tickets.panel.kinds.${panel.kind}`)}, ${where})\n${categories || `-# ${ctx.t('tickets.panel.empty')}`}`;
}

async function autocomplete(interaction: AutocompleteInteraction, _bot: Bot): Promise<void> {
  if (!interaction.guildId) return interaction.respond([]);
  const focused = interaction.options.getFocused(true);
  const typed = String(focused.value).toLowerCase();
  const panels = await PanelModel.find({ guildId: interaction.guildId }).sort({ panelId: 1 }).lean<PanelDoc[]>();

  if (focused.name === 'panel') {
    return interaction.respond(
      panels
        .filter((p) => `${p.panelId} ${p.title}`.toLowerCase().includes(typed))
        .slice(0, 25)
        .map((p) => ({ name: `#${p.panelId} ${p.title}`.slice(0, 100), value: p.panelId })),
    );
  }
  const panel = panels.find((p) => p.panelId === interaction.options.getInteger('panel'));
  return interaction.respond(
    (panel?.categories ?? [])
      .filter((c) => c.label.toLowerCase().includes(typed) || c.id.includes(typed))
      .slice(0, 25)
      .map((c) => ({ name: c.label.slice(0, 100), value: c.id })),
  );
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('tickets.admin.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommandGroup((g) =>
      g
        .setName('panel')
        .setDescription('tickets.admin.panel.description')
        .addSubcommand((s) =>
          s
            .setName('create')
            .setDescription('tickets.admin.panel.create')
            .addStringOption((o) => o.setName('title').setDescription('tickets.admin.options.title').setRequired(true).setMaxLength(100))
            .addStringOption((o) => o.setName('description').setDescription('tickets.admin.options.description').setMaxLength(1500))
            .addStringOption((o) =>
              o
                .setName('style')
                .setDescription('tickets.admin.options.style')
                .addChoices({ name: 'tickets.panel.kinds.buttons', value: 'buttons' }, { name: 'tickets.panel.kinds.select', value: 'select' }),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('edit')
            .setDescription('tickets.admin.panel.edit')
            .addIntegerOption((o) => o.setName('panel').setDescription('tickets.admin.options.panel').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName('title').setDescription('tickets.admin.options.title').setMaxLength(100))
            .addStringOption((o) => o.setName('description').setDescription('tickets.admin.options.description').setMaxLength(1500))
            .addStringOption((o) =>
              o
                .setName('style')
                .setDescription('tickets.admin.options.style')
                .addChoices({ name: 'tickets.panel.kinds.buttons', value: 'buttons' }, { name: 'tickets.panel.kinds.select', value: 'select' }),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('send')
            .setDescription('tickets.admin.panel.send')
            .addIntegerOption((o) => o.setName('panel').setDescription('tickets.admin.options.panel').setRequired(true).setAutocomplete(true))
            .addChannelOption((o) => o.setName('channel').setDescription('tickets.admin.options.channel').setRequired(true).addChannelTypes(...SENDABLE)),
        )
        .addSubcommand((s) =>
          s
            .setName('delete')
            .setDescription('tickets.admin.panel.delete')
            .addIntegerOption((o) => o.setName('panel').setDescription('tickets.admin.options.panel').setRequired(true).setAutocomplete(true)),
        )
        .addSubcommand((s) => s.setName('list').setDescription('tickets.admin.panel.list')),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('category')
        .setDescription('tickets.admin.category.description')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('tickets.admin.category.add')
            .addIntegerOption((o) => o.setName('panel').setDescription('tickets.admin.options.panel').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName('label').setDescription('tickets.admin.options.label').setRequired(true).setMaxLength(80))
            .addStringOption((o) => o.setName('description').setDescription('tickets.admin.options.categoryDescription').setMaxLength(100))
            .addStringOption((o) => o.setName('emoji').setDescription('tickets.admin.options.emoji').setMaxLength(64))
            .addStringOption((o) =>
              o
                .setName('color')
                .setDescription('tickets.admin.options.color')
                .addChoices(...BUTTON_STYLES.map((s) => ({ name: `tickets.admin.styles.${s}`, value: s }))),
            )
            .addRoleOption((o) => o.setName('staff_role').setDescription('tickets.admin.options.staffRole'))
            .addChannelOption((o) => o.setName('parent').setDescription('tickets.admin.options.parent').addChannelTypes(ChannelType.GuildCategory))
            .addStringOption((o) => o.setName('welcome').setDescription('tickets.admin.options.welcome').setMaxLength(1000)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('tickets.admin.category.remove')
            .addIntegerOption((o) => o.setName('panel').setDescription('tickets.admin.options.panel').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName('category').setDescription('tickets.admin.options.category').setRequired(true).setAutocomplete(true)),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('question')
        .setDescription('tickets.admin.question.description')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('tickets.admin.question.add')
            .addIntegerOption((o) => o.setName('panel').setDescription('tickets.admin.options.panel').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName('category').setDescription('tickets.admin.options.category').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName('label').setDescription('tickets.admin.options.question').setRequired(true).setMaxLength(45))
            .addBooleanOption((o) => o.setName('long').setDescription('tickets.admin.options.long'))
            .addBooleanOption((o) => o.setName('required').setDescription('tickets.admin.options.required'))
            .addStringOption((o) => o.setName('placeholder').setDescription('tickets.admin.options.placeholder').setMaxLength(100)),
        )
        .addSubcommand((s) =>
          s
            .setName('clear')
            .setDescription('tickets.admin.question.clear')
            .addIntegerOption((o) => o.setName('panel').setDescription('tickets.admin.options.panel').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName('category').setDescription('tickets.admin.options.category').setRequired(true).setAutocomplete(true)),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('settings')
        .setDescription('tickets.admin.settings.description')
        .addIntegerOption((o) => o.setName('max_open').setDescription('tickets.admin.settings.maxOpen').setMinValue(1).setMaxValue(10))
        .addIntegerOption((o) => o.setName('reminder_hours').setDescription('tickets.admin.settings.reminderHours').setMinValue(0).setMaxValue(720))
        .addIntegerOption((o) => o.setName('auto_close_hours').setDescription('tickets.admin.settings.autoCloseHours').setMinValue(0).setMaxValue(2160))
        .addBooleanOption((o) => o.setName('dm_transcript').setDescription('tickets.admin.settings.dmTranscript'))
        .addStringOption((o) => o.setName('name_pattern').setDescription('tickets.admin.settings.namePattern').setMaxLength(60))
        .addChannelOption((o) =>
          o.setName('modmail_category').setDescription('tickets.admin.settings.modmailCategory').addChannelTypes(ChannelType.GuildCategory),
        ),
    ),
  defer: 'ephemeral',
  permissions: { user: PermissionFlagsBits.ManageGuild },
  autocomplete,
  async run(ctx) {
    const { options } = ctx.interaction;
    const group = options.getSubcommandGroup();
    const sub = options.getSubcommand();
    const guildId = ctx.guild.id;

    if (!group && sub === 'settings') {
      const current = await ctx.bot.settings.module(guildId, ticketSettings);
      const patch: Partial<TicketSettings> = {};
      const maxOpen = options.getInteger('max_open');
      const reminder = options.getInteger('reminder_hours');
      const autoClose = options.getInteger('auto_close_hours');
      const dm = options.getBoolean('dm_transcript');
      const pattern = options.getString('name_pattern');
      const modmailCategory = options.getChannel('modmail_category');
      if (maxOpen !== null) patch.maxOpenPerUser = maxOpen;
      if (reminder !== null) patch.reminderHours = reminder;
      if (autoClose !== null) patch.autoCloseHours = autoClose;
      if (dm !== null) patch.dmTranscript = dm;
      if (pattern !== null) patch.namePattern = pattern;
      if (modmailCategory) patch.modmail = { ...current.modmail, categoryId: modmailCategory.id };
      const s = await ctx.bot.settings.updateModule(guildId, ticketSettings, patch);
      await ctx.respond(
        ctx.successPanel(
          ctx.t('tickets.admin.settings.saved', {
            maxOpen: s.maxOpenPerUser,
            reminder: s.reminderHours || ctx.t('common.off'),
            autoClose: s.autoCloseHours || ctx.t('common.off'),
            dm: ctx.t(s.dmTranscript ? 'common.on' : 'common.off'),
            pattern: s.namePattern,
          }),
        ),
      );
      return;
    }

    if (group === 'panel') {
      if (sub === 'list') {
        const panels = await PanelModel.find({ guildId }).sort({ panelId: 1 }).lean<PanelDoc[]>();
        const text = panels.map((p) => panelSummary(ctx, p)).join('\n\n') || ctx.t('tickets.panel.none');
        await ctx.respond(ctx.panel().title(ctx.t('tickets.panel.listTitle')).text(text.slice(0, 3900)));
        return;
      }
      if (sub === 'create') {
        if ((await PanelModel.countDocuments({ guildId })) >= MAX_PANELS) throw new UserError('tickets.errors.tooManyPanels', { max: MAX_PANELS });
        const panelId = await nextSequence(`ticket-panel:${guildId}`);
        await PanelModel.create({
          guildId,
          panelId,
          title: options.getString('title', true),
          description: options.getString('description') ?? '',
          kind: (options.getString('style') as PanelDoc['kind'] | null) ?? 'buttons',
        });
        await ctx.respond(ctx.successPanel(ctx.t('tickets.panel.created', { id: panelId, command: ctx.bot.commandMention('tickets category add') })));
        return;
      }

      const panel = await findPanel(guildId, options.getInteger('panel', true));
      if (sub === 'send') {
        const url = await publishPanel(ctx.bot, ctx.guild, panel, options.getChannel('channel', true).id);
        await ctx.respond(ctx.successPanel(ctx.t('tickets.panel.sent', { url })));
      } else if (sub === 'edit') {
        const patch: Partial<PanelDoc> = {};
        const title = options.getString('title');
        const description = options.getString('description');
        const style = options.getString('style') as PanelDoc['kind'] | null;
        if (title) patch.title = title;
        if (description !== null) patch.description = description;
        if (style) patch.kind = style;
        await savePanel(ctx, panel, patch);
        await ctx.respond(ctx.successPanel(ctx.t('tickets.panel.updated', { id: panel.panelId })));
      } else if (sub === 'delete') {
        await PanelModel.deleteOne({ guildId, panelId: panel.panelId });
        if (panel.channelId && panel.messageId) {
          const channel = ctx.guild.channels.cache.get(panel.channelId);
          if (channel?.isTextBased()) await channel.messages.delete(panel.messageId).catch(() => undefined);
        }
        await ctx.respond(ctx.successPanel(ctx.t('tickets.panel.deleted', { id: panel.panelId })));
      }
      return;
    }

    const panel = await findPanel(guildId, options.getInteger('panel', true));

    if (group === 'category') {
      if (sub === 'add') {
        if (panel.categories.length >= MAX_CATEGORIES) throw new UserError('tickets.errors.tooManyCategories', { max: MAX_CATEGORIES });
        const category: TicketCategory = {
          id: randomBytes(3).toString('hex'),
          label: options.getString('label', true),
          description: options.getString('description'),
          emoji: options.getString('emoji'),
          style: (options.getString('color') as ButtonStyleName | null) ?? 'primary',
          staffRoles: [options.getRole('staff_role')?.id].filter((id): id is string => Boolean(id)),
          parentId: options.getChannel('parent')?.id ?? null,
          questions: [],
          welcome: options.getString('welcome'),
        };
        await savePanel(ctx, panel, { categories: [...panel.categories, category] });
        await ctx.respond(ctx.successPanel(ctx.t('tickets.category.added', { label: category.label, id: panel.panelId })));
      } else {
        const category = findCategory(panel, options.getString('category', true));
        await savePanel(ctx, panel, { categories: panel.categories.filter((c) => c.id !== category.id) });
        await ctx.respond(ctx.successPanel(ctx.t('tickets.category.removed', { label: category.label })));
      }
      return;
    }

    if (group === 'question') {
      const category = findCategory(panel, options.getString('category', true));
      let questions = category.questions;
      if (sub === 'add') {
        if (questions.length >= MAX_QUESTIONS) throw new UserError('tickets.errors.tooManyQuestions', { max: MAX_QUESTIONS });
        questions = [
          ...questions,
          {
            label: options.getString('label', true),
            placeholder: options.getString('placeholder'),
            long: options.getBoolean('long') ?? false,
            required: options.getBoolean('required') ?? true,
          },
        ];
      } else {
        questions = [];
      }
      const categories = panel.categories.map((c) => (c.id === category.id ? { ...c, questions } : c));
      await savePanel(ctx, panel, { categories });
      await ctx.respond(ctx.successPanel(ctx.t('tickets.question.saved', { label: category.label, count: questions.length })));
    }
  },
});
