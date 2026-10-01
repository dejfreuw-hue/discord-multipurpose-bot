import { GatewayIntentBits, Partials } from 'discord.js';
import { defineModule } from '../../core/module.js';
import { loadOpenChannels } from './activity.js';
import modmail from './commands/modmail.js';
import ticket from './commands/ticket.js';
import tickets from './commands/tickets.js';
import { controlComponents } from './controls.js';
import { channelDelete, messageCreate } from './events/messages.js';
import { startInactivityLoop } from './inactivity.js';
import { modmailPick } from './modmail.js';
import { panelComponents } from './panels.js';
import { ticketsConfig, ticketSettings } from './settings.js';
import { ticketsSetupComponents, ticketsStep } from './setup.js';

let stopInactivity: (() => void) | undefined;

const ticketsModule = defineModule({
  name: 'tickets',
  toggleable: true,
  // Message Content (privileged) is needed for transcripts and modmail relays. DMs arrive on
  // their own intent, and the Channel partial is how discord.js delivers DM channels.
  intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
  config: ticketsConfig,
  guildSettings: ticketSettings.guildSettings,
  commands: [tickets, ticket, modmail],
  components: [...panelComponents, ...controlComponents, modmailPick, ...ticketsSetupComponents],
  events: [messageCreate, channelDelete],
  setup: [ticketsStep],
  async start(bot) {
    const open = await loadOpenChannels();
    bot.logger.debug({ open }, 'tracking open tickets');
    stopInactivity = startInactivityLoop(bot, bot.moduleConfig(ticketsModule).inactivityCheckMinutes);
  },
  stop() {
    stopInactivity?.();
  },
});

export default ticketsModule;
