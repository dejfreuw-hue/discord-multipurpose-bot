import { GatewayIntentBits } from 'discord.js';
import { defineModule } from '../../../core/module.js';
import { startBirthdayClock } from './celebrate.js';
import { birthday, birthdays } from './commands.js';
import { birthdaySettings } from './settings.js';
import { birthdaySetupComponents, birthdayStep } from './setup.js';

let stopClock: (() => void) | undefined;

export default defineModule({
  name: 'birthdays',
  toggleable: true,
  intents: [GatewayIntentBits.Guilds],
  guildSettings: birthdaySettings.guildSettings,
  commands: [birthday, birthdays],
  components: birthdaySetupComponents,
  setup: [birthdayStep],
  start(bot) {
    stopClock = startBirthdayClock(bot);
  },
  stop() {
    stopClock?.();
  },
});
