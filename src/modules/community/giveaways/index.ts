import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type AutocompleteInteraction,
  type SlashCommandIntegerOption,
} from 'discord.js';
import { parseDuration } from '../../../core/duration.js';
import { UserError } from '../../../core/errors.js';
import { nextSequence } from '../../../core/models/counter.js';
import { defineCommand, defineComponent, defineModule } from '../../../core/module.js';
import { cancelGiveaway, endGiveaway, renderGiveaway, rerollGiveaway, startScheduler, toggleEntry } from './giveaway.js';
import { GiveawayModel, type GiveawayDoc } from './model.js';

const MAX_DURATION = 60 * 24 * 60 * 60 * 1000;
const MIN_DURATION = 60 * 1000;
let stopScheduler: (() => void) | undefined;

async function find(guildId: string, id: number): Promise<GiveawayDoc> {
  const g = await GiveawayModel.findOne({ guildId, giveawayId: id }).lean<GiveawayDoc>();
  if (!g) throw new UserError('giveaways.errors.notFound', { id });
  return g;
}

async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guildId) return interaction.respond([]);
  const sub = interaction.options.getSubcommand();
  const status: GiveawayDoc['status'] = sub === 'reroll' ? 'ended' : 'running';
  const list = await GiveawayModel.find({ guildId: interaction.guildId, status }).sort({ giveawayId: -1 }).limit(25).lean<GiveawayDoc[]>();
  await interaction.respond(list.map((g) => ({ name: `#${g.giveawayId} ${g.prize}`.slice(0, 100), value: g.giveawayId })));
}

const idOption = (o: SlashCommandIntegerOption) =>
  o.setName('id').setDescription('giveaways.command.options.id').setRequired(true).setAutocomplete(true);

const command = defineCommand({
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('giveaways.command.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('giveaways.command.start')
        .addStringOption((o) => o.setName('prize').setDescription('giveaways.command.options.prize').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('duration').setDescription('giveaways.command.options.duration').setRequired(true).setMaxLength(20))
        .addIntegerOption((o) => o.setName('winners').setDescription('giveaways.command.options.winners').setMinValue(1).setMaxValue(50))
        .addStringOption((o) => o.setName('description').setDescription('giveaways.command.options.description').setMaxLength(1000))
        .addChannelOption((o) => o.setName('channel').setDescription('giveaways.command.options.channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addRoleOption((o) => o.setName('required_role').setDescription('giveaways.command.options.requiredRole'))
        .addIntegerOption((o) => o.setName('min_account_days').setDescription('giveaways.command.options.minAccountDays').setMinValue(0).setMaxValue(3650))
        .addIntegerOption((o) => o.setName('min_server_days').setDescription('giveaways.command.options.minServerDays').setMinValue(0).setMaxValue(3650))
        .addIntegerOption((o) => o.setName('min_level').setDescription('giveaways.command.options.minLevel').setMinValue(0).setMaxValue(1000))
        .addIntegerOption((o) => o.setName('booster_entries').setDescription('giveaways.command.options.boosterEntries').setMinValue(0).setMaxValue(10))
        .addRoleOption((o) => o.setName('bonus_role').setDescription('giveaways.command.options.bonusRole'))
        .addIntegerOption((o) => o.setName('bonus_entries').setDescription('giveaways.command.options.bonusEntries').setMinValue(1).setMaxValue(10)),
    )
    .addSubcommand((s) => s.setName('end').setDescription('giveaways.command.end').addIntegerOption(idOption))
    .addSubcommand((s) =>
      s
        .setName('reroll')
        .setDescription('giveaways.command.reroll')
        .addIntegerOption(idOption)
        .addIntegerOption((o) => o.setName('winners').setDescription('giveaways.command.options.rerollWinners').setMinValue(1).setMaxValue(50)),
    )
    .addSubcommand((s) => s.setName('cancel').setDescription('giveaways.command.cancel').addIntegerOption(idOption))
    .addSubcommand((s) => s.setName('list').setDescription('giveaways.command.list')),
  defer: 'ephemeral',
  permissions: { user: PermissionFlagsBits.ManageGuild, allowStaff: true },
  autocomplete,
  async run(ctx) {
    const { options } = ctx.interaction;
    const sub = options.getSubcommand();

    if (sub === 'start') {
      const raw = options.getString('duration', true);
      const duration = parseDuration(raw);
      if (duration === null || duration < MIN_DURATION || duration > MAX_DURATION) throw new UserError('giveaways.errors.duration', { value: raw });
      const channel = ctx.guild.channels.cache.get(options.getChannel('channel')?.id ?? ctx.interaction.channelId);
      if (!channel?.isSendable()) throw new UserError('tickets.errors.panelChannel');
      const bonusRole = options.getRole('bonus_role');

      const created = await GiveawayModel.create({
        guildId: ctx.guild.id,
        giveawayId: await nextSequence(`giveaway:${ctx.guild.id}`),
        channelId: channel.id,
        hostId: ctx.member.id,
        prize: options.getString('prize', true),
        description: options.getString('description'),
        winnerCount: options.getInteger('winners') ?? 1,
        endsAt: new Date(Date.now() + duration),
        requirements: {
          roleId: options.getRole('required_role')?.id ?? null,
          minAccountDays: options.getInteger('min_account_days') ?? 0,
          minServerDays: options.getInteger('min_server_days') ?? 0,
          minLevel: options.getInteger('min_level') ?? 0,
        },
        bonus: {
          boosterEntries: options.getInteger('booster_entries') ?? 0,
          bonusRoles: bonusRole ? [{ roleId: bonusRole.id, entries: options.getInteger('bonus_entries') ?? 1 }] : [],
        },
      });
      const g = created.toObject();
      const message = await channel.send({ ...(await renderGiveaway(ctx.bot, g)).render(), allowedMentions: { parse: [] } });
      await GiveawayModel.updateOne({ guildId: g.guildId, giveawayId: g.giveawayId }, { messageId: message.id });
      await ctx.respond(ctx.successPanel(ctx.t('giveaways.command.started', { id: g.giveawayId, url: message.url, time: time(g.endsAt, TimestampStyles.RelativeTime) })));
      return;
    }
    if (sub === 'list') {
      const list = await GiveawayModel.find({ guildId: ctx.guild.id, status: 'running' }).sort({ endsAt: 1 }).limit(25).lean<GiveawayDoc[]>();
      const lines = list.map((g) => `**#${g.giveawayId} ${g.prize}** · <#${g.channelId}> · ${time(g.endsAt, TimestampStyles.RelativeTime)} · ${g.entrants.length}`);
      await ctx.respond(ctx.panel().title(ctx.t('giveaways.command.listTitle')).text(lines.join('\n') || ctx.t('giveaways.command.none')));
      return;
    }

    const g = await find(ctx.guild.id, options.getInteger('id', true));
    if (sub === 'end') {
      if (g.status !== 'running') throw new UserError('giveaways.errors.notRunning');
      const winners = await endGiveaway(ctx.bot, g);
      await ctx.respond(ctx.successPanel(ctx.t('giveaways.command.ended', { count: winners.length })));
    } else if (sub === 'reroll') {
      const winners = await rerollGiveaway(ctx.bot, ctx.guild, g, options.getInteger('winners') ?? 1);
      await ctx.respond(ctx.successPanel(ctx.t('giveaways.command.rerolled', { count: winners.length })));
    } else if (sub === 'cancel') {
      await cancelGiveaway(ctx.bot, g);
      await ctx.respond(ctx.successPanel(ctx.t('giveaways.command.cancelled', { id: g.giveawayId })));
    }
  },
});

const enter = defineComponent({
  kind: 'button',
  id: 'giveaway:enter',
  defer: 'ephemeral',
  async run(ctx, [id]) {
    const entered = await toggleEntry(ctx.bot, ctx.member, Number(id));
    await ctx.respond(ctx.successPanel(ctx.t(entered ? 'giveaways.entered' : 'giveaways.left')));
  },
});

export default defineModule({
  name: 'giveaways',
  toggleable: true,
  commands: [command],
  components: [enter],
  start(bot) {
    stopScheduler = startScheduler(bot);
  },
  stop() {
    stopScheduler?.();
  },
});
