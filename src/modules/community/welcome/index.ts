import { Events, GatewayIntentBits } from 'discord.js';
import { defineEvent, defineModule } from '../../../core/module.js';
import welcomeCommand from './command.js';
import { sendWelcome } from './message.js';
import { welcomeSettings } from './settings.js';
import { welcomeSetupComponents, welcomeStep } from './setup.js';

const memberAdd = defineEvent({
  name: Events.GuildMemberAdd,
  async run(bot, member) {
    if (!bot.isEnabled('welcome', await bot.settings.get(member.guild.id))) return;
    await sendWelcome(bot, member.guild, member.user, 'join');
  },
});

const memberRemove = defineEvent({
  name: Events.GuildMemberRemove,
  async run(bot, member) {
    if (!bot.isEnabled('welcome', await bot.settings.get(member.guild.id))) return;
    await sendWelcome(bot, member.guild, member.user, 'leave');
  },
});

export default defineModule({
  name: 'welcome',
  toggleable: true,
  // Server Members is privileged: join and leave events only arrive with it switched on.
  intents: [GatewayIntentBits.GuildMembers],
  guildSettings: welcomeSettings.guildSettings,
  commands: [welcomeCommand],
  components: welcomeSetupComponents,
  events: [memberAdd, memberRemove],
  setup: [welcomeStep],
});
