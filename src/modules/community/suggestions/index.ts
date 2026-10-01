import {
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ThreadAutoArchiveDuration,
  userMention,
  type AutocompleteInteraction,
  type Guild,
} from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import { UserError } from '../../../core/errors.js';
import { nextSequence } from '../../../core/models/counter.js';
import { defineCommand, defineComponent, defineModule } from '../../../core/module.js';
import { throttler } from '../../../core/throttle.js';
import { CLOSED, recordVote, SuggestionModel, type SuggestionDoc, type SuggestionStatus } from './model.js';
import { suggestionSettings } from './settings.js';
import { suggestionSetupComponents, suggestionStep } from './setup.js';
import { approval } from './votes.js';

const COLORS: Record<SuggestionStatus, number | null> = { open: null, considered: 0xfee75c, approved: 0x57f287, implemented: 0x5865f2, denied: 0xed4245 };
const refresh = throttler(5000);

async function render(bot: Bot, guild: Guild, s: SuggestionDoc) {
  const core = await bot.settings.get(guild.id);
  const t = (k: string, v?: Record<string, string | number>) => bot.i18n.t(bot.guildLocale(core), k, v);
  const author = await bot.client.users.fetch(s.authorId).catch(() => null);
  const percent = approval(s.up.length, s.down.length);
  const open = !CLOSED.includes(s.status);

  const panel = bot
    .panel(COLORS[s.status] ?? core.color ?? bot.config.bot.color)
    .title(t('suggestions.panel.title', { number: s.number }))
    .thumbnail(author?.displayAvatarURL({ size: 128 }))
    .text(s.content, `-# ${t('suggestions.panel.by', { user: userMention(s.authorId) })}`)
    .fields([
      { name: t('suggestions.panel.status'), value: t(`suggestions.status.${s.status}`), inline: true },
      {
        name: t('suggestions.panel.votes'),
        value: t('suggestions.panel.voteLine', { up: s.up.length, down: s.down.length, percent: percent === null ? '-' : `${percent}%` }),
        inline: true,
      },
      ...(s.reason || s.decidedBy
        ? [{ name: t('suggestions.panel.response', { user: s.decidedBy ? userMention(s.decidedBy) : '-' }), value: s.reason ?? '-' }]
        : []),
    ]);
  return panel.row(
    new ButtonBuilder().setCustomId(`suggest:vote:${s.number}:up`).setStyle(ButtonStyle.Success).setLabel(t('suggestions.panel.up', { count: s.up.length })).setDisabled(!open),
    new ButtonBuilder().setCustomId(`suggest:vote:${s.number}:down`).setStyle(ButtonStyle.Danger).setLabel(t('suggestions.panel.down', { count: s.down.length })).setDisabled(!open),
  );
}

async function updateMessage(bot: Bot, guild: Guild, guildId: string, number: number): Promise<void> {
  const s = await SuggestionModel.findOne({ guildId, number }).lean<SuggestionDoc>();
  if (!s?.messageId) return;
  const channel = guild.channels.cache.get(s.channelId);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(s.messageId).catch(() => null);
  await message?.edit({ ...(await render(bot, guild, s)).render(), allowedMentions: { parse: [] } });
}

const suggest = defineCommand({
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('suggestions.suggest.description')
    .addStringOption((o) => o.setName('idea').setDescription('suggestions.suggest.options.idea').setRequired(true).setMinLength(10).setMaxLength(2000)),
  defer: 'ephemeral',
  cooldown: 60,
  async run(ctx) {
    const settings = await ctx.bot.settings.module(ctx.guild.id, suggestionSettings);
    const channel = settings.channelId ? ctx.guild.channels.cache.get(settings.channelId) : null;
    if (!channel?.isSendable() || channel.type !== ChannelType.GuildText) throw new UserError('suggestions.errors.noChannel');

    const created = await SuggestionModel.create({
      guildId: ctx.guild.id,
      number: await nextSequence(`suggestion:${ctx.guild.id}`),
      authorId: ctx.member.id,
      content: ctx.interaction.options.getString('idea', true),
      channelId: channel.id,
    });
    const s = created.toObject();
    const message = await channel.send({ ...(await render(ctx.bot, ctx.guild, s)).render(), allowedMentions: { parse: [] } });
    await SuggestionModel.updateOne({ guildId: s.guildId, number: s.number }, { messageId: message.id });
    if (settings.threads) {
      await message
        .startThread({ name: ctx.t('suggestions.thread', { number: s.number }), autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek })
        .catch(() => undefined);
    }
    await ctx.respond(ctx.successPanel(ctx.t('suggestions.suggest.done', { url: message.url })));
  },
});

async function numberAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guildId) return interaction.respond([]);
  const typed = String(interaction.options.getFocused());
  const list = await SuggestionModel.find({ guildId: interaction.guildId }).sort({ number: -1 }).limit(100).lean<SuggestionDoc[]>();
  await interaction.respond(
    list
      .filter((s) => String(s.number).startsWith(typed))
      .slice(0, 25)
      .map((s) => ({ name: `#${s.number} ${s.content}`.slice(0, 100), value: s.number })),
  );
}

const manage = defineCommand({
  data: new SlashCommandBuilder()
    .setName('suggestion')
    .setDescription('suggestions.manage.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('respond')
        .setDescription('suggestions.manage.respond')
        .addIntegerOption((o) => o.setName('number').setDescription('suggestions.manage.options.number').setRequired(true).setAutocomplete(true))
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('suggestions.manage.options.status')
            .setRequired(true)
            .addChoices(
              { name: 'suggestions.status.approved', value: 'approved' },
              { name: 'suggestions.status.denied', value: 'denied' },
              { name: 'suggestions.status.considered', value: 'considered' },
              { name: 'suggestions.status.implemented', value: 'implemented' },
              { name: 'suggestions.status.open', value: 'open' },
            ),
        )
        .addStringOption((o) => o.setName('reason').setDescription('suggestions.manage.options.reason').setMaxLength(1000)),
    )
    .addSubcommand((s) =>
      s
        .setName('settings')
        .setDescription('suggestions.manage.settings')
        .addChannelOption((o) => o.setName('channel').setDescription('suggestions.manage.options.channel').addChannelTypes(ChannelType.GuildText))
        .addBooleanOption((o) => o.setName('threads').setDescription('suggestions.manage.options.threads'))
        .addBooleanOption((o) => o.setName('dm_author').setDescription('suggestions.manage.options.dmAuthor')),
    ),
  defer: 'ephemeral',
  permissions: { user: PermissionFlagsBits.ManageGuild, allowStaff: true },
  autocomplete: numberAutocomplete,
  async run(ctx) {
    const { options } = ctx.interaction;
    const settings = await ctx.bot.settings.module(ctx.guild.id, suggestionSettings);

    if (options.getSubcommand() === 'settings') {
      const updated = await ctx.bot.settings.updateModule(ctx.guild.id, suggestionSettings, {
        channelId: options.getChannel('channel')?.id ?? settings.channelId,
        threads: options.getBoolean('threads') ?? settings.threads,
        dmAuthor: options.getBoolean('dm_author') ?? settings.dmAuthor,
      });
      await ctx.respond(
        ctx.successPanel(
          ctx.t('suggestions.manage.saved', {
            channel: updated.channelId ? `<#${updated.channelId}>` : ctx.t('common.none'),
            threads: ctx.t(updated.threads ? 'common.on' : 'common.off'),
            dm: ctx.t(updated.dmAuthor ? 'common.on' : 'common.off'),
          }),
        ),
      );
      return;
    }

    const number = options.getInteger('number', true);
    const status = options.getString('status', true) as SuggestionStatus;
    const reason = options.getString('reason');
    const s = await SuggestionModel.findOneAndUpdate(
      { guildId: ctx.guild.id, number },
      { status, reason, decidedBy: ctx.member.id },
      { returnDocument: 'after', lean: true },
    );
    if (!s) throw new UserError('suggestions.errors.notFound', { number });
    await updateMessage(ctx.bot, ctx.guild, ctx.guild.id, number);

    if (settings.dmAuthor && status !== 'open') {
      const author = await ctx.bot.client.users.fetch(s.authorId).catch(() => null);
      const text = ctx.t('suggestions.dm', { number, server: ctx.guild.name, status: ctx.t(`suggestions.status.${status}`) });
      await author?.send(ctx.panel().text(text, reason ? `> ${reason}` : null).render()).catch(() => undefined);
    }
    await ctx.respond(ctx.successPanel(ctx.t('suggestions.manage.done', { number, status: ctx.t(`suggestions.status.${status}`) })));
  },
});

const vote = defineComponent({
  kind: 'button',
  id: 'suggest:vote',
  defer: 'ephemeral',
  async run(ctx, [rawNumber, side]) {
    const number = Number(rawNumber);
    if (side !== 'up' && side !== 'down') throw new UserError('errors.expired');
    const counted = await recordVote(ctx.guild.id, number, ctx.member.id, side);
    if (!counted) {
      const exists = await SuggestionModel.exists({ guildId: ctx.guild.id, number });
      throw exists ? new UserError('suggestions.errors.closed') : new UserError('suggestions.errors.notFound', { number });
    }
    refresh(`${ctx.guild.id}:${number}`, () => updateMessage(ctx.bot, ctx.guild, ctx.guild.id, number));
    await ctx.respond(ctx.successPanel(ctx.t(`suggestions.voted.${counted}`)));
  },
});

export default defineModule({
  name: 'suggestions',
  toggleable: true,
  guildSettings: suggestionSettings.guildSettings,
  commands: [suggest, manage],
  components: [vote, ...suggestionSetupComponents],
  setup: [suggestionStep],
});
