import { ButtonBuilder, ButtonStyle, SlashCommandBuilder, userMention } from 'discord.js';
import type { Player } from 'lavalink-client';
import type { InteractionContext } from '../../../core/context.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand, defineComponent } from '../../../core/module.js';
import { shuffle } from '../actions.js';
import { activePlayer, assertControl } from '../control.js';
import { formatTime } from '../format.js';
import { playerFor, saveSession } from '../lavalink.js';
import { nowPlayingPanel, requesterOf, trackLink } from '../nowplaying.js';

const PAGE_SIZE = 10;

export function queuePanel(ctx: InteractionContext, player: Player, page: number) {
  const tracks = player.queue.tracks;
  const pages = Math.max(1, Math.ceil(tracks.length / PAGE_SIZE));
  const current = Math.min(Math.max(0, page), pages - 1);
  const lines = tracks.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((t, i) => {
    const requester = requesterOf(t);
    const duration = t.info.isStream ? ctx.t('music.nowPlaying.live') : formatTime(t.info.duration ?? 0);
    return `**${current * PAGE_SIZE + i + 1}.** ${trackLink(t)} \`${duration}\`${requester ? ` · ${userMention(requester.id)}` : ''}`;
  });
  const total = player.queue.utils.totalDuration();
  const id = (p: number) => `music:queue:${p}`;

  return ctx
    .panel()
    .title(ctx.t('music.queue.title'))
    .text(
      player.queue.current ? `${ctx.t('music.queue.now')} ${trackLink(player.queue.current)}` : null,
      lines.length > 0 ? lines.join('\n') : ctx.t('music.queue.empty'),
    )
    .footer(
      `${ctx.t('moderation.case.page', { page: current + 1, pages })} · ${ctx.t('music.queue.summary', { count: tracks.length, duration: formatTime(total) })}`,
    )
    .row(
      new ButtonBuilder().setCustomId(id(current - 1)).setStyle(ButtonStyle.Secondary).setLabel(ctx.t('moderation.case.previous')).setDisabled(current === 0),
      new ButtonBuilder().setCustomId(id(current + 1)).setStyle(ButtonStyle.Secondary).setLabel(ctx.t('moderation.case.next')).setDisabled(current + 1 >= pages),
    );
}

export const queuePage = defineComponent({
  kind: 'button',
  id: 'music:queue',
  async run(ctx, [page]) {
    const player = playerFor(ctx.guild.id);
    if (!player) throw new UserError('music.errors.nothingPlaying');
    await ctx.update(queuePanel(ctx, player, Number(page) || 0));
  },
});

export const queueCommand = defineCommand({
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('music.queue.description')
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('music.queue.view')
        .addIntegerOption((o) => o.setName('page').setDescription('leveling.leaderboard.options.page').setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('music.queue.remove')
        .addIntegerOption((o) => o.setName('position').setDescription('music.queue.options.position').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName('move')
        .setDescription('music.queue.move')
        .addIntegerOption((o) => o.setName('from').setDescription('music.queue.options.from').setRequired(true).setMinValue(1))
        .addIntegerOption((o) => o.setName('to').setDescription('music.queue.options.to').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) => s.setName('shuffle').setDescription('music.queue.shuffle'))
    .addSubcommand((s) => s.setName('clear').setDescription('music.queue.clear')),
  async run(ctx) {
    const sub = ctx.interaction.options.getSubcommand();
    if (sub === 'view') {
      const player = playerFor(ctx.guild.id);
      if (!player) throw new UserError('music.errors.nothingPlaying');
      await ctx.respond(queuePanel(ctx, player, (ctx.interaction.options.getInteger('page') ?? 1) - 1));
      return;
    }

    const player = activePlayer(ctx);
    const size = player.queue.tracks.length;
    const position = (name: string) => {
      const value = ctx.interaction.options.getInteger(name, true);
      if (value > size) throw new UserError('music.errors.badPosition', { max: size });
      return value - 1;
    };

    if (sub === 'remove') {
      const index = position('position');
      const track = player.queue.tracks[index]!;
      // Removing your own request is always fine; anything else follows the DJ rules.
      if (requesterOf(track)?.id !== ctx.member.id) await assertControl(ctx, player);
      await player.queue.splice(index, 1);
      await ctx.respond(ctx.successPanel(ctx.t('music.queue.removed', { track: trackLink(track) })));
      return;
    }

    await assertControl(ctx, player);
    if (sub === 'move') {
      const from = position('from');
      const to = position('to');
      const [track] = await player.queue.splice(from, 1);
      if (track) await player.queue.add(track, to);
      await ctx.respond(ctx.successPanel(ctx.t('music.queue.moved', { track: track ? trackLink(track) : '-', position: to + 1 })));
    } else if (sub === 'shuffle') {
      await shuffle(player);
      await ctx.respond(ctx.successPanel(ctx.t('music.queue.shuffled', { count: size })));
    } else if (sub === 'clear') {
      await player.queue.splice(0, size);
      await saveSession(player);
      await ctx.respond(ctx.successPanel(ctx.t('music.queue.cleared', { count: size })));
    }
  },
});

export const nowPlayingCommand = defineCommand({
  data: new SlashCommandBuilder().setName('nowplaying').setDescription('music.nowPlaying.description'),
  async run(ctx) {
    const player = playerFor(ctx.guild.id);
    if (!player?.queue.current) throw new UserError('music.errors.nothingPlaying');
    await ctx.respond(nowPlayingPanel(ctx.bot, player, (k, v) => ctx.t(k, v), ctx.color));
  },
});
