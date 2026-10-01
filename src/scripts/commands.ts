import { REST, Routes, type APIApplication } from 'discord.js';
import { loadEnv } from '../config/env.js';
import { ConfigError } from '../config/errors.js';
import { loadConfig } from '../config/load.js';
import { buildCommands, clearCommands, syncCommands } from '../core/command-sync.js';
import { I18n } from '../core/i18n.js';
import { fromRoot } from '../core/paths.js';
import { modules } from '../modules/index.js';

// Registers or removes slash commands without starting the bot.
//   npm run commands:deploy
//   npm run commands:clear

async function main(): Promise<void> {
  const action = process.argv[2];
  if (action !== 'deploy' && action !== 'clear') {
    console.error('usage: node dist/scripts/commands.js <deploy|clear>');
    process.exit(1);
  }

  const env = loadEnv();
  const config = loadConfig(modules);
  const rest = new REST().setToken(env.DISCORD_TOKEN);
  const app = (await rest.get(Routes.currentApplication())) as APIApplication;
  const target = config.commands.devGuildId ? `guild ${config.commands.devGuildId}` : 'global';

  if (action === 'clear') {
    await clearCommands({ token: env.DISCORD_TOKEN, applicationId: app.id, devGuildId: config.commands.devGuildId });
    process.stdout.write('removed all commands\n');
    return;
  }

  const i18n = I18n.fromDirectory(fromRoot('locales'), config.bot.locale);
  const enabled = modules.filter((m) => config.moduleSettings.has(m.name));
  const commands = buildCommands(enabled, i18n, config.moduleSettings);
  await syncCommands(commands, {
    token: env.DISCORD_TOKEN,
    applicationId: app.id,
    devGuildId: config.commands.devGuildId,
    force: true,
  });
  process.stdout.write(`registered ${commands.length} commands (${target})\n`);
}

main().catch((err: unknown) => {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
