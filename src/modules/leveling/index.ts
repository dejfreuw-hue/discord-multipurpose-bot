import { GatewayIntentBits } from 'discord.js';
import { defineModule } from '../../core/module.js';
import leaderboard, { leaderboardPage } from './commands/leaderboard.js';
import levels, { resetAllConfirm } from './commands/levels.js';
import rank from './commands/rank.js';
import rankcard from './commands/rankcard.js';
import messages from './events/messages.js';
import { levelingConfig, levelingSettings } from './settings.js';
import { levelingSetupComponents, levelingStep } from './setup.js';
import { startVoiceTicker } from './voice.js';

let stopVoice: (() => void) | undefined;

const leveling = defineModule({
  name: 'leveling',
  toggleable: true,
  // No privileged intents: message XP doesn't need to read message content.
  intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates],
  config: levelingConfig,
  guildSettings: levelingSettings.guildSettings,
  commands: [rank, leaderboard, rankcard, levels],
  components: [leaderboardPage, resetAllConfirm, ...levelingSetupComponents],
  events: [messages],
  setup: [levelingStep],
  start(bot) {
    stopVoice = startVoiceTicker(bot, bot.moduleConfig(leveling).voiceTickSeconds);
  },
  stop() {
    stopVoice?.();
  },
});

export default leveling;
