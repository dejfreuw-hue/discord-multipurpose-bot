import { GatewayIntentBits, Partials } from 'discord.js';
import { defineModule } from '../../../core/module.js';
import { autorole, rolemenu } from './commands.js';
import { memberAdd, memberUpdate, reactionAdd, reactionRemove } from './events.js';
import { loadReactionMenus, menuComponents } from './menus.js';
import { rolesSettings } from './settings.js';
import { rolesSetupComponents, rolesStep } from './setup.js';

export default defineModule({
  name: 'roles',
  toggleable: true,
  // Server Members (privileged) for auto-roles; reactions on messages from before a restart
  // only arrive with the Message, Reaction and User partials.
  intents: [GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessageReactions],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
  guildSettings: rolesSettings.guildSettings,
  commands: [autorole, rolemenu],
  components: [...menuComponents, ...rolesSetupComponents],
  events: [memberAdd, memberUpdate, reactionAdd, reactionRemove],
  setup: [rolesStep],
  async start() {
    await loadReactionMenus();
  },
});
