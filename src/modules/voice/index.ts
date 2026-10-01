import { GatewayIntentBits } from 'discord.js';
import { defineModule } from '../../core/module.js';
import { cleanUp } from './channels.js';
import voiceCommand from './command.js';
import { channelDelete, voiceStateUpdate } from './events.js';
import { panelComponents } from './panel.js';
import { voiceConfig, voiceSettings } from './settings.js';
import { voiceSetupComponents, voiceStep } from './setup.js';

export default defineModule({
  name: 'voice',
  toggleable: true,
  intents: [GatewayIntentBits.GuildVoiceStates],
  config: voiceConfig,
  guildSettings: voiceSettings.guildSettings,
  commands: [voiceCommand],
  components: [...panelComponents, ...voiceSetupComponents],
  events: [voiceStateUpdate, channelDelete],
  setup: [voiceStep],
  async start(bot) {
    await cleanUp(bot);
  },
});
