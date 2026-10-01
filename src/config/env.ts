import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { fromRoot } from '../core/paths.js';
import { ConfigError, describeIssues } from './errors.js';

const envSchema = z.object({
  DISCORD_TOKEN: z
    .string({ error: 'missing. Copy your bot token from the Developer Portal (Bot -> Reset Token)' })
    .min(50, 'does not look like a bot token. Copy it again from the Developer Portal (Bot -> Reset Token)'),
  MONGODB_URI: z
    .string({ error: 'missing. Use mongodb://127.0.0.1:27017/reuwbot for a local install or your Atlas connection string' })
    .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
  LICENSE_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),
  ANTHROPIC_API_KEY: z.string().default(''),
  GEMINI_API_KEY: z.string().default(''),
  AI_COMPAT_API_KEY: z.string().default(''),
  DEEPL_API_KEY: z.string().default(''),
  LIBRETRANSLATE_API_KEY: z.string().default(''),
  TWITCH_CLIENT_ID: z.string().default(''),
  TWITCH_CLIENT_SECRET: z.string().default(''),
  LAVALINK_HOST: z.string().default('127.0.0.1'),
  LAVALINK_PORT: z.coerce.number().int().min(1).max(65535).default(2333),
  LAVALINK_PASSWORD: z.string().default('youshallnotpass'),
  LAVALINK_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.output<typeof envSchema>;

export function loadEnv(): Env {
  loadDotenv({ path: fromRoot('.env'), quiet: true });
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new ConfigError(
      `${describeIssues('.env', parsed.error.issues)}\n\nCopy .env.example to .env if you haven't yet, fill in the values above and restart.`,
    );
  }
  return parsed.data;
}
