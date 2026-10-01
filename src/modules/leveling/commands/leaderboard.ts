import { ButtonBuilder, ButtonStyle, SlashCommandBuilder, userMention } from 'discord.js';
import type { InteractionContext } from '../../../core/context.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand, defineComponent } from '../../../core/module.js';
import { progressFor } from '../curve.js';
import { ProfileModel, type ProfileDoc } from '../models.js';
import { curveOf } from '../xp.js';

const PAGE_SIZE = 10;
const SORTS = { xp: 'xp', voice: 'voiceMinutes', messages: 'messages' } as const;
type Sort = keyof typeof SORTS;

async function leaderboard(ctx: InteractionContext, guildId: string, sort: Sort, page: number) {
  const field = SORTS[sort];
  const filter = { guildId, [field]: { $gt: 0 } };
  const total = await ProfileModel.countDocuments(filter);
  if (total === 0) throw new UserError('leveling.leaderboard.empty');
  const pages = Math.ceil(total / PAGE_SIZE);
  const current = Math.min(Math.max(0, page), pages - 1);
  const rows = await ProfileModel.find(filter)
    .sort({ [field]: -1, _id: 1 })
    .skip(current * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .lean<ProfileDoc[]>();

  const curve = curveOf(ctx.bot);
  const lines = rows.map((p, i) => {
    const position = current * PAGE_SIZE + i + 1;
    const stat =
      sort === 'xp'
        ? ctx.t('leveling.leaderboard.xpLine', { level: progressFor(p.xp, curve).level, xp: p.xp.toLocaleString() })
        : sort === 'voice'
          ? ctx.t('leveling.leaderboard.voiceLine', { minutes: p.voiceMinutes.toLocaleString() })
          : ctx.t('leveling.leaderboard.messagesLine', { messages: p.messages.toLocaleString() });
    return `**${position}.** ${userMention(p.userId)} · ${stat}`;
  });

  const own = await ProfileModel.findOne({ guildId, userId: ctx.interaction.user.id }).lean<ProfileDoc>();
  const ownRank = own && own[field] > 0 ? (await ProfileModel.countDocuments({ guildId, [field]: { $gt: own[field] } })) + 1 : null;
  const id = (target: number) => `leveling:lb:${sort}:${target}`;

  return ctx
    .panel()
    .title(ctx.t(`leveling.leaderboard.title.${sort}`))
    .thumbnail(ctx.guild?.iconURL({ size: 128 }))
    .text(lines.join('\n'))
    .footer(
      [ctx.t('moderation.case.page', { page: current + 1, pages }), ownRank ? ctx.t('leveling.leaderboard.you', { rank: ownRank }) : null]
        .filter(Boolean)
        .join(' · '),
    )
    .row(
      new ButtonBuilder().setCustomId(id(current - 1)).setStyle(ButtonStyle.Secondary).setLabel(ctx.t('moderation.case.previous')).setDisabled(current === 0),
      new ButtonBuilder()
        .setCustomId(id(current + 1))
        .setStyle(ButtonStyle.Secondary)
        .setLabel(ctx.t('moderation.case.next'))
        .setDisabled(current + 1 >= pages),
    );
}

export const leaderboardPage = defineComponent({
  kind: 'button',
  id: 'leveling:lb',
  async run(ctx, [sort, page]) {
    const key = (sort && sort in SORTS ? sort : 'xp') as Sort;
    await ctx.update(await leaderboard(ctx, ctx.guild.id, key, Number(page) || 0));
  },
});

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('leveling.leaderboard.description')
    .addStringOption((o) =>
      o
        .setName('by')
        .setDescription('leveling.leaderboard.options.by')
        .addChoices(
          { name: 'leveling.leaderboard.sorts.xp', value: 'xp' },
          { name: 'leveling.leaderboard.sorts.voice', value: 'voice' },
          { name: 'leveling.leaderboard.sorts.messages', value: 'messages' },
        ),
    )
    .addIntegerOption((o) => o.setName('page').setDescription('leveling.leaderboard.options.page').setMinValue(1)),
  defer: 'public',
  async run(ctx) {
    const sort = (ctx.interaction.options.getString('by') ?? 'xp') as Sort;
    const page = (ctx.interaction.options.getInteger('page') ?? 1) - 1;
    await ctx.respond(await leaderboard(ctx, ctx.guild.id, sort, page));
  },
});
