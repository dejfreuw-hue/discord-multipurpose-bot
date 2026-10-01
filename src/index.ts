import { readFileSync } from 'node:fs';
import { loadEnv } from './config/env.js';
import { ConfigError } from './config/errors.js';
import { loadConfig } from './config/load.js';
import { Bot } from './core/bot.js';
import { connectDatabase, disconnectDatabase } from './core/database.js';
import { GuildSettings } from './core/guild-settings.js';
import { I18n } from './core/i18n.js';
import { createLogger, flushLogger, type Logger } from './core/logger.js';
import { fromRoot } from './core/paths.js';
import { LicenseError, verifyLicense } from './license/verify.js';
import { modules } from './modules/index.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

let logger: Logger | undefined;

async function main(): Promise<void> {
  const env = loadEnv();
  const config = loadConfig(modules);
  logger = createLogger(config.logging);
  const log = logger;

  const { version } = JSON.parse(readFileSync(fromRoot('package.json'), 'utf8')) as { version: string };
  log.info({ version, node: process.version }, 'starting');

  await verifyLicense(env.LICENSE_KEY, version, log);

  const i18n = I18n.fromDirectory(fromRoot('locales'), config.bot.locale, (key, locale) =>
    log.warn({ key, locale }, 'missing translation'),
  );
  if (!i18n.has(config.bot.locale)) {
    const available = i18n.list().map((l) => l.code).join(', ');
    throw new ConfigError(`config.yml: bot.locale is "${config.bot.locale}" but there is no locales/${config.bot.locale}.json. Available: ${available}.`);
  }

  await connectDatabase(env.MONGODB_URI, log);

  const bot = new Bot({ config, env, logger: log, i18n, settings: new GuildSettings(log), modules, version });

  let shuttingDown = false;
  const shutdown = async (signal: string, code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    // Some hosts send SIGTERM and then wait forever; never hang longer than this.
    setTimeout(() => process.exit(code || 1), SHUTDOWN_TIMEOUT_MS).unref();
    try {
      await bot.stop();
      await disconnectDatabase();
    } catch (err) {
      log.error({ err }, 'error during shutdown');
    }
    await flushLogger(log);
    process.exit(code);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled rejection'));
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'uncaught exception');
    void shutdown('uncaughtException', 1);
  });

  await bot.start();
}

main().catch(async (err: unknown) => {
  if (err instanceof ConfigError || err instanceof LicenseError) {
    console.error(`\n${err.message}\n`);
  } else if (isTokenError(err)) {
    console.error('\nDiscord rejected the bot token. Reset it in the Developer Portal (Bot -> Reset Token) and update DISCORD_TOKEN in .env.\n');
  } else if (isIntentError(err)) {
    console.error(
      '\nDiscord refused the requested gateway intents. Open the Developer Portal -> Bot and turn on the Privileged Gateway Intents listed in the README, then restart.\n',
    );
  } else if (logger) {
    logger.fatal({ err }, 'startup failed');
  } else {
    console.error(err);
  }
  if (logger) await flushLogger(logger);
  process.exit(1);
});

function isTokenError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ('status' in err && err.status === 401) return true;
  return 'code' in err && (err.code === 'TokenInvalid' || err.code === 'TokenMissing');
}

function isIntentError(err: unknown): boolean {
  return err instanceof Error && /disallowed intents/i.test(err.message);
}
