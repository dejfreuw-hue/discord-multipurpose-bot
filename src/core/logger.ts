import { join } from 'node:path';
import pino, { type Logger, type TransportTargetOptions } from 'pino';
import type { Config } from '../config/schema.js';
import { fromRoot } from './paths.js';

export type { Logger };

export function createLogger(options: Config['logging']): Logger {
  const stdout: TransportTargetOptions = options.pretty
    ? {
        target: 'pino-pretty',
        level: options.level,
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      }
    : { target: 'pino/file', level: options.level, options: { destination: 1 } };

  const file: TransportTargetOptions = {
    target: 'pino-roll',
    level: options.level,
    options: {
      file: join(fromRoot(options.dir), 'bot'),
      extension: '.log',
      frequency: 'daily',
      dateFormat: 'yyyy-MM-dd',
      size: options.maxSize,
      limit: { count: options.retainFiles },
      mkdir: true,
    },
  };

  return pino(
    { level: options.level, base: undefined, serializers: { err: pino.stdSerializers.err } },
    pino.transport({ targets: [stdout, file] }),
  );
}

/**
 * Gives the transport worker a moment to drain before exiting. pino also flushes on
 * process.exit, but the flush callback doesn't always fire for worker transports, so this
 * never waits longer than `timeoutMs`.
 */
export function flushLogger(logger: Logger, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    logger.flush(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
