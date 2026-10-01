import mongoose from 'mongoose';
import { ConfigError } from '../config/errors.js';
import type { Logger } from './logger.js';

export async function connectDatabase(uri: string, logger: Logger): Promise<void> {
  mongoose.set('strictQuery', true);

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigError(
      [
        `Could not connect to MongoDB at ${redact(uri)}`,
        `Reason: ${reason}`,
        '',
        'Check that:',
        '  - MongoDB is running (local install or the "mongo" container in docker-compose)',
        '  - MONGODB_URI in .env is correct, including username and password for Atlas',
        '  - on Atlas, your server IP is allowed under Network Access',
      ].join('\n'),
    );
  }
  // Attached after the first connect so a failed startup prints one clear message, not three.
  mongoose.connection.on('disconnected', () => logger.warn('mongo disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('mongo reconnected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'mongo error'));
  logger.info({ db: mongoose.connection.name }, 'connected to mongo');
}

export async function databasePing(): Promise<number> {
  const db = mongoose.connection.db;
  if (!db) return -1;
  const started = performance.now();
  await db.admin().ping();
  return Math.round(performance.now() - started);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

function redact(uri: string): string {
  return uri.replace(/\/\/([^@/]+)@/, '//***@');
}
