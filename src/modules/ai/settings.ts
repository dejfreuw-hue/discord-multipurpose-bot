import { z } from 'zod';
import type { SettingsSlice } from '../../core/guild-settings.js';
import { PERSONALITIES } from './personalities.js';
import { PROVIDERS } from './providers/types.js';

const models = (chat: string, vision: string) =>
  z.strictObject({ chatModel: z.string().default(chat), visionModel: z.string().default(vision) }).prefault({});

export const aiConfig = z.object({
  defaultProvider: z.enum(PROVIDERS).default('anthropic'),
  providers: z
    .strictObject({
      openai: models('gpt-4.1-mini', 'gpt-4.1-mini'),
      anthropic: models('claude-sonnet-5-5', 'claude-haiku-4-5-20251001'),
      gemini: models('gemini-2.5-flash', 'gemini-2.5-flash'),
      compatible: z
        .strictObject({
          baseUrl: z.union([z.literal(''), z.url({ error: 'must be a full URL like http://localhost:11434/v1' })]).default(''),
          chatModel: z.string().default(''),
          visionModel: z.string().default(''),
        })
        .prefault({}),
    })
    .prefault({}),
  maxOutputTokens: z.number().int().min(50).max(8000).default(800),
  timeoutSeconds: z.number().int().min(5).max(180).default(45),
  maxDailyTokens: z.number().int().min(0).default(500_000),
});

export type AiConfig = z.output<typeof aiConfig>;

const threshold = (value: number) => z.number().int().min(0).max(100).default(value);

const guildSettings = z.object({
  provider: z.enum(PROVIDERS).nullable().default(null),
  channels: z.array(z.string()).default([]),
  replyToMentions: z.boolean().default(true),
  personality: z.enum(Object.keys(PERSONALITIES) as [string, ...string[]]).or(z.literal('custom')).default('helpful'),
  customPrompt: z.string().max(1500).nullable().default(null),
  /** User and role IDs that may not use the AI features. */
  blacklist: z.array(z.string()).default([]),
  dailyTokens: z.number().int().min(0).default(50_000),
  userPerMinute: z.number().int().min(1).max(30).default(4),
  history: z.number().int().min(0).max(30).default(8),
  scanner: z
    .object({
      enabled: z.boolean().default(false),
      /** Empty means every channel. */
      channels: z.array(z.string()).default([]),
      // Confidence (0-100) at or above which each action happens. 0 turns that action off.
      alert: threshold(60),
      delete: threshold(80),
      timeout: threshold(95),
      timeoutMinutes: z.number().int().min(1).max(40_320).default(60),
    })
    .prefault({}),
});

export type AiSettings = z.output<typeof guildSettings>;

export const aiSettings: SettingsSlice<typeof guildSettings> = { name: 'ai', guildSettings };
