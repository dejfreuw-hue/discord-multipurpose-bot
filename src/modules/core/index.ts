import { defineModule } from '../../core/module.js';
import botinfo from './commands/botinfo.js';
import help, { helpCategory, helpHome } from './commands/help.js';
import ping from './commands/ping.js';
import setup from './commands/setup.js';
import { coreConfig } from './config.js';
import { coreSteps, setupComponents } from './setup/wizard.js';

export default defineModule({
  name: 'core',
  toggleable: false,
  config: coreConfig,
  commands: [help, ping, botinfo, setup],
  components: [helpCategory, helpHome, ...setupComponents],
  setup: coreSteps,
});
