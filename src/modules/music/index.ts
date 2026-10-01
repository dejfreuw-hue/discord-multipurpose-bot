import { GatewayIntentBits } from 'discord.js';
import { defineModule } from '../../core/module.js';
import lyrics from './commands/lyrics.js';
import {
  alwaysOnCommand,
  filterCommand,
  leaveCommand,
  loopCommand,
  pauseCommand,
  previousCommand,
  resumeCommand,
  seekCommand,
  skipCommand,
  stopCommand,
  volumeCommand,
} from './commands/playback.js';
import play from './commands/play.js';
import { nowPlayingCommand, queueCommand, queuePage } from './commands/queue.js';
import { controller } from './controller.js';
import voice from './events/voice.js';
import { startLavalink, stopLavalink } from './lavalink.js';
import { musicConfig, musicSettings } from './settings.js';
import { musicSetupComponents, musicStep } from './setup.js';

export default defineModule({
  name: 'music',
  toggleable: true,
  intents: [GatewayIntentBits.GuildVoiceStates],
  config: musicConfig,
  guildSettings: musicSettings.guildSettings,
  commands: [
    play,
    skipCommand,
    previousCommand,
    stopCommand,
    pauseCommand,
    resumeCommand,
    seekCommand,
    volumeCommand,
    loopCommand,
    filterCommand,
    queueCommand,
    nowPlayingCommand,
    lyrics,
    leaveCommand,
    alwaysOnCommand,
  ],
  components: [controller, queuePage, ...musicSetupComponents],
  events: [voice],
  setup: [musicStep],
  async start(bot) {
    await startLavalink(bot);
  },
  async stop() {
    await stopLavalink();
  },
});
