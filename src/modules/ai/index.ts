import { GatewayIntentBits } from 'discord.js';
import { defineModule } from '../../core/module.js';
import ai, { personaSubmit } from './commands/ai.js';
import ask from './commands/ask.js';
import { availableProviders } from './engine.js';
import messages from './events/messages.js';
import { aiConfig, aiSettings } from './settings.js';
import { aiSetupComponents, aiStep } from './setup.js';

export default defineModule({
  name: 'ai',
  toggleable: true,
  // MessageContent is privileged: it has to be switched on in the Developer Portal.
  intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  config: aiConfig,
  guildSettings: aiSettings.guildSettings,
  commands: [ask, ai],
  components: [personaSubmit, ...aiSetupComponents],
  events: [messages],
  setup: [aiStep],
  start(bot) {
    const names = [...availableProviders(bot).keys()];
    if (names.length === 0) bot.logger.warn('ai module is on but no provider is set up; add an API key to .env');
    else bot.logger.info({ providers: names }, 'ai providers ready');
  },
});
