import { GatewayIntentBits } from 'discord.js';
import { defineModule } from '../../core/module.js';
import { banCommand, unbanCommand } from './commands/ban.js';
import caseCommand, { historyPage } from './commands/case.js';
import kick from './commands/kick.js';
import { lockCommand, unlockCommand } from './commands/lock.js';
import purge from './commands/purge.js';
import slowmode from './commands/slowmode.js';
import temprole from './commands/temprole.js';
import timeout from './commands/timeout.js';
import warn from './commands/warn.js';
import auditLog from './events/audit-log.js';
import { startExpiryLoop } from './expiry.js';
import { moderationConfig, moderationSettings } from './settings.js';
import { moderationSetupComponents, moderationStep } from './setup.js';

let stopExpiry: (() => void) | undefined;

const moderation = defineModule({
  name: 'moderation',
  toggleable: true,
  // Needed for the audit log event that records actions taken outside the bot. Not privileged.
  intents: [GatewayIntentBits.GuildModeration],
  config: moderationConfig,
  guildSettings: moderationSettings.guildSettings,
  commands: [banCommand, unbanCommand, kick, timeout, warn, purge, slowmode, lockCommand, unlockCommand, caseCommand, temprole],
  components: [historyPage, ...moderationSetupComponents],
  events: [auditLog],
  setup: [moderationStep],
  start(bot) {
    stopExpiry = startExpiryLoop(bot, bot.moduleConfig(moderation).expiryCheckSeconds);
  },
  stop() {
    stopExpiry?.();
  },
});

export default moderation;
