import { defineModule } from '../../core/module.js';
import { balance, baltop, baltopPage, depositCommand, pay, withdrawCommand } from './commands/account.js';
import { economyAdmin } from './commands/admin.js';
import { blackjack, blackjackMove } from './commands/blackjack.js';
import { daily, rob, weekly, work } from './commands/earn.js';
import { coinflip, slots } from './commands/gamble.js';
import { inventory, shop } from './commands/shop.js';
import { endGame, games } from './games/session.js';
import { slotsReturnRate } from './math.js';
import { economyConfig, economySettings } from './settings.js';
import { economySetupComponents, economyStep } from './setup.js';
import { credit } from './wallet.js';

const economy = defineModule({
  name: 'economy',
  toggleable: true,
  config: economyConfig,
  guildSettings: economySettings.guildSettings,
  commands: [balance, depositCommand, withdrawCommand, pay, baltop, daily, weekly, work, rob, coinflip, slots, blackjack, shop, inventory, economyAdmin],
  components: [baltopPage, blackjackMove, ...economySetupComponents],
  setup: [economyStep],
  start(bot) {
    const rate = slotsReturnRate(bot.moduleConfig(economy).slots);
    bot.logger.info({ returnRate: Math.round(rate * 1000) / 10 }, 'slots return rate (percent)');
    if (rate >= 1) bot.logger.warn('slots pay out more than they take; members will get rich fast');
  },
  async stop() {
    // Stakes of unfinished blackjack games already left the wallet; give them back.
    for (const game of [...games.values()]) {
      endGame(game);
      if (!game.settled) await credit(game.guildId, game.userId, game.bet);
    }
  },
});

export default economy;
