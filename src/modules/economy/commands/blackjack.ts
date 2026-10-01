import { ButtonBuilder, ButtonStyle, SlashCommandBuilder, type ButtonInteraction } from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import type { ComponentContext, InteractionContext } from '../../../core/context.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand, defineComponent } from '../../../core/module.js';
import type { Panel } from '../../../core/ui/panel.js';
import { cardLabel, handValue, isBlackjack, outcomeMultiplier, playDealer, settle, type Card } from '../games/blackjack.js';
import { activeGame, endGame, startGame, type BlackjackGame } from '../games/session.js';
import { economyOf, readBet } from '../helpers.js';
import { payout } from '../math.js';
import { economyConfig, economySettings, formatMoney } from '../settings.js';
import { credit, debit } from '../wallet.js';

const hand = (cards: readonly Card[]) => `${cards.map(cardLabel).join('  ')}  (${handValue(cards).total})`;

async function view(bot: Bot, ctx: InteractionContext, game: BlackjackGame, finished: string | null): Promise<Panel> {
  const settings = await bot.settings.module(game.guildId, economySettings);
  const money = (n: number) => `**${formatMoney(n, settings.currency)}**`;
  const dealer = finished ? hand(game.dealer) : `${cardLabel(game.dealer[0]!)}  ??`;
  const panel = ctx
    .panel()
    .title(ctx.t('economy.blackjack.title'))
    .fields([
      { name: ctx.t('economy.blackjack.you'), value: hand(game.player), inline: true },
      { name: ctx.t('economy.blackjack.dealer'), value: dealer, inline: true },
      { name: ctx.t('economy.blackjack.bet'), value: money(game.bet), inline: true },
    ]);
  if (finished) return panel.text(finished);

  const id = (action: string) => `economy:bj:${action}:${game.id}`;
  const canDouble = game.player.length === 2 && !game.doubled;
  return panel.row(
    new ButtonBuilder().setCustomId(id('hit')).setStyle(ButtonStyle.Primary).setLabel(ctx.t('economy.blackjack.hit')),
    new ButtonBuilder().setCustomId(id('stand')).setStyle(ButtonStyle.Secondary).setLabel(ctx.t('economy.blackjack.stand')),
    new ButtonBuilder().setCustomId(id('double')).setStyle(ButtonStyle.Success).setLabel(ctx.t('economy.blackjack.double')).setDisabled(!canDouble),
  );
}

/** Plays out the dealer, pays the result and returns the closing line. */
async function finish(bot: Bot, ctx: InteractionContext, game: BlackjackGame): Promise<string | null> {
  if (game.settled) return null;
  game.settled = true;
  endGame(game);
  const settings = await bot.settings.module(game.guildId, economySettings);
  if (handValue(game.player).total <= 21 && !isBlackjack(game.player)) playDealer(game.dealer, game.deck);
  const outcome = settle(game.player, game.dealer);
  const returned = payout(game.bet, outcomeMultiplier(outcome, settings.gambling.blackjackPays));
  await credit(game.guildId, game.userId, returned);
  const money = (n: number) => `**${formatMoney(n, settings.currency)}**`;
  return ctx.t(`economy.blackjack.outcomes.${outcome}`, { amount: money(Math.abs(returned - game.bet)), bet: money(game.bet) });
}

function armTimeout(bot: Bot, ctx: InteractionContext, game: BlackjackGame): void {
  if (game.timer) clearTimeout(game.timer);
  const seconds = bot.moduleConfig({ name: 'economy', config: economyConfig }).blackjackTimeoutSeconds;
  // Walking away counts as standing, so the stake is never left in limbo.
  game.timer = setTimeout(() => {
    void (async () => {
      if (game.busy) return;
      const text = await finish(bot, ctx, game);
      if (text === null) return;
      await ctx.interaction.editReply((await view(bot, ctx, game, `${ctx.t('economy.blackjack.timedOut')}\n${text}`)).render()).catch(() => undefined);
    })().catch((err) => bot.logger.warn({ err }, 'blackjack timeout failed'));
  }, seconds * 1000);
  game.timer.unref();
}

export const blackjack = defineCommand({
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('economy.blackjack.description')
    .addStringOption((o) => o.setName('bet').setDescription('economy.options.bet').setRequired(true).setMaxLength(20)),
  async run(ctx) {
    if (activeGame(ctx.guild.id, ctx.member.id)) throw new UserError('economy.blackjack.inProgress');
    const { account, settings } = await economyOf(ctx);
    const bet = readBet(ctx, settings, account.wallet);
    if (!(await debit(ctx.guild.id, ctx.member.id, bet))) throw new UserError('economy.errors.funds');

    const game = startGame(ctx.guild.id, ctx.member.id, bet);
    if (isBlackjack(game.player) || isBlackjack(game.dealer)) {
      await ctx.respond(await view(ctx.bot, ctx, game, (await finish(ctx.bot, ctx, game)) ?? ''));
      return;
    }
    await ctx.respond(await view(ctx.bot, ctx, game, null));
    armTimeout(ctx.bot, ctx, game);
  },
});

export const blackjackMove = defineComponent({
  kind: 'button',
  id: 'economy:bj',
  async run(ctx, [action, id]) {
    const game = activeGame(ctx.guild.id, ctx.interaction.user.id);
    if (!game || game.id !== id) throw new UserError('economy.blackjack.notYours');
    if (game.busy || game.settled) return;
    game.busy = true;
    try {
      await move(ctx, game, action ?? '');
    } finally {
      game.busy = false;
    }
  },
});

async function move(ctx: ComponentContext<ButtonInteraction<'cached'>>, game: BlackjackGame, action: string): Promise<void> {
  if (action === 'double') {
    if (game.player.length !== 2 || game.doubled) throw new UserError('errors.expired');
    if (!(await debit(game.guildId, game.userId, game.bet))) throw new UserError('economy.blackjack.cantDouble');
    game.bet *= 2;
    game.doubled = true;
    game.player.push(game.deck.pop()!);
  } else if (action === 'hit') {
    game.player.push(game.deck.pop()!);
  }

  const total = handValue(game.player).total;
  if (action === 'stand' || action === 'double' || total >= 21) {
    const text = await finish(ctx.bot, ctx, game);
    if (text !== null) await ctx.update(await view(ctx.bot, ctx, game, text));
    return;
  }
  await ctx.update(await view(ctx.bot, ctx, game, null));
  armTimeout(ctx.bot, ctx, game);
}
