import { ButtonBuilder, ButtonStyle, PermissionFlagsBits, SlashCommandBuilder, userMention } from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import type { InteractionContext } from '../../../core/context.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand, defineComponent } from '../../../core/module.js';
import { caseLine, casePanel, refreshLogMessage } from '../cases.js';
import { CASE_TYPES, CaseModel, type CaseDoc } from '../models/case.js';

const PAGE_SIZE = 8;

async function findCase(guildId: string, caseId: number): Promise<CaseDoc> {
  const entry = await CaseModel.findOne({ guildId, caseId }).lean<CaseDoc>();
  if (!entry) throw new UserError('moderation.case.notFound', { id: caseId });
  return entry;
}

async function historyPanel(ctx: InteractionContext, bot: Bot, guildId: string, userId: string, page: number) {
  const filter = { guildId, userId };
  const [total, entries, counts] = await Promise.all([
    CaseModel.countDocuments(filter),
    CaseModel.find(filter)
      .sort({ caseId: -1 })
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean<CaseDoc[]>(),
    CaseModel.aggregate<{ _id: string; n: number }>([{ $match: filter }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
  ]);
  if (total === 0) throw new UserError('moderation.case.noHistory', { user: userMention(userId) });

  const pages = Math.ceil(total / PAGE_SIZE);
  const summary = CASE_TYPES.map((type) => ({ type, n: counts.find((c) => c._id === type)?.n ?? 0 }))
    .filter((c) => c.n > 0)
    .map((c) => `${ctx.t(`moderation.types.${c.type}`)}: **${c.n}**`)
    .join(' · ');

  const id = (target: number) => `moderation:history:${userId}:${target}:${ctx.interaction.user.id}`;
  return ctx
    .panel()
    .title(ctx.t('moderation.case.historyTitle'))
    .text(userMention(userId), summary)
    .divider()
    .text(entries.map((e) => caseLine(bot, ctx.locale, e)).join('\n\n'))
    .footer(ctx.t('moderation.case.page', { page: page + 1, pages }))
    .row(
      new ButtonBuilder().setCustomId(id(page - 1)).setStyle(ButtonStyle.Secondary).setLabel(ctx.t('moderation.case.previous')).setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(id(page + 1))
        .setStyle(ButtonStyle.Secondary)
        .setLabel(ctx.t('moderation.case.next'))
        .setDisabled(page + 1 >= pages),
    );
}

export const historyPage = defineComponent({
  kind: 'button',
  id: 'moderation:history',
  async run(ctx, [userId, page, owner]) {
    if (owner !== ctx.interaction.user.id) throw new UserError('moderation.case.notYours');
    await ctx.update(await historyPanel(ctx, ctx.bot, ctx.guild.id, userId!, Math.max(0, Number(page))));
  },
});

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('moderation.case.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('moderation.case.view')
        .addIntegerOption((o) => o.setName('id').setDescription('moderation.case.options.id').setRequired(true).setMinValue(1).setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('moderation.case.edit')
        .addIntegerOption((o) => o.setName('id').setDescription('moderation.case.options.id').setRequired(true).setMinValue(1).setAutocomplete(true))
        .addStringOption((o) => o.setName('reason').setDescription('moderation.case.options.reason').setRequired(true).setMaxLength(400)),
    )
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('moderation.case.delete')
        .addIntegerOption((o) => o.setName('id').setDescription('moderation.case.options.id').setRequired(true).setMinValue(1).setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('history')
        .setDescription('moderation.case.history')
        .addUserOption((o) => o.setName('user').setDescription('moderation.options.user').setRequired(true)),
    ),
  permissions: { user: PermissionFlagsBits.ModerateMembers, allowStaff: true },
  async run(ctx) {
    const { options } = ctx.interaction;
    const guildId = ctx.guild.id;

    switch (options.getSubcommand()) {
      case 'view': {
        const entry = await findCase(guildId, options.getInteger('id', true));
        await ctx.respond(casePanel(ctx.bot, ctx.locale, entry));
        return;
      }
      case 'edit': {
        const entry = await findCase(guildId, options.getInteger('id', true));
        entry.reason = options.getString('reason', true);
        await CaseModel.updateOne({ guildId, caseId: entry.caseId }, { reason: entry.reason });
        await refreshLogMessage(ctx.bot, ctx.guild, entry);
        await ctx.respond(casePanel(ctx.bot, ctx.locale, entry));
        return;
      }
      case 'delete': {
        // Deleting history is an admin decision, even for staff who can view cases.
        if (!ctx.member.permissions.has(PermissionFlagsBits.ManageGuild) && !ctx.bot.isOwner(ctx.member.id)) {
          throw new UserError('moderation.case.deleteDenied');
        }
        const entry = await findCase(guildId, options.getInteger('id', true));
        await CaseModel.deleteOne({ guildId, caseId: entry.caseId });
        await ctx.respond(ctx.successPanel(ctx.t('moderation.case.deleted', { id: entry.caseId })));
        return;
      }
      case 'history': {
        const user = options.getUser('user', true);
        await ctx.respond(await historyPanel(ctx, ctx.bot, guildId, user.id, 0));
        return;
      }
    }
  },
  async autocomplete(interaction, bot) {
    if (!interaction.guildId) return interaction.respond([]);
    const typed = String(interaction.options.getFocused());
    const recent = await CaseModel.find({ guildId: interaction.guildId }).sort({ caseId: -1 }).limit(100).lean<CaseDoc[]>();
    const locale = bot.guildLocale(bot.settings.peek(interaction.guildId));
    const choices = recent
      .filter((c) => String(c.caseId).startsWith(typed))
      .slice(0, 25)
      .map((c) => ({
        name: `#${c.caseId} ${bot.i18n.t(locale, `moderation.types.${c.type}`)} - ${c.userTag}${c.reason ? ` - ${c.reason}` : ''}`.slice(0, 100),
        value: c.caseId,
      }));
    await interaction.respond(choices);
  },
});
