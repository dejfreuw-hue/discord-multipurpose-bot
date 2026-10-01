import { GatewayIntentBits } from 'discord.js';
import { defineModule } from '../../core/module.js';
import { spamTracker } from './check.js';
import automod, { configureSubmit } from './commands/automod.js';
import ghostPing from './events/ghost-ping.js';
import { messageCreate, messageUpdate } from './events/messages.js';
import { automodConfig, automodSettings } from './settings.js';
import { automodSetupComponents, automodStep } from './setup.js';

export default defineModule({
  name: 'automod',
  toggleable: true,
  // MessageContent is privileged: it has to be switched on in the Developer Portal.
  intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  config: automodConfig,
  guildSettings: automodSettings.guildSettings,
  commands: [automod],
  components: [configureSubmit, ...automodSetupComponents],
  events: [messageCreate, messageUpdate, ghostPing],
  setup: [automodStep],
  stop() {
    spamTracker.dispose();
  },
});
