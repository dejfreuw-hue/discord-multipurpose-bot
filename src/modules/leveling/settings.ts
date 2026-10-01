import { z } from 'zod';
import type { SettingsSlice } from '../../core/guild-settings.js';

export { PRESET_NAMES } from '../../core/ui/canvas.js';

export const levelingConfig = z.object({
  curve: z
    .strictObject({
      quadratic: z.number().min(0).max(1000).default(5),
      linear: z.number().min(0).max(10_000).default(50),
      base: z.number().min(1).max(1_000_000).default(100),
    })
    .prefault({}),
  voiceTickSeconds: z.number().int().min(30).max(600).default(60),
  maxBackgroundMB: z.number().min(1).max(25).default(8),
});

const guildSettings = z.object({
  text: z
    .object({
      enabled: z.boolean().default(true),
      min: z.number().int().min(0).max(1000).default(15),
      max: z.number().int().min(0).max(1000).default(25),
      cooldownSeconds: z.number().int().min(0).max(3600).default(60),
    })
    .prefault({}),
  voice: z
    .object({
      enabled: z.boolean().default(true),
      perMinute: z.number().int().min(0).max(1000).default(10),
      /** Only count members who aren't alone in the channel, so idling alone earns nothing. */
      requireOthers: z.boolean().default(true),
    })
    .prefault({}),
  announce: z
    .object({
      mode: z.enum(['channel', 'dm', 'fixed', 'off']).default('channel'),
      channelId: z.string().nullable().default(null),
      /** Custom text with {user}, {username} and {level}. Null uses the translated default. */
      message: z.string().max(500).nullable().default(null),
    })
    .prefault({}),
  rewards: z.array(z.object({ level: z.number().int().min(1), roleId: z.string() })).default([]),
  stackRewards: z.boolean().default(true),
  multipliers: z.array(z.object({ roleId: z.string(), value: z.number().min(0).max(10) })).default([]),
  ignoredChannels: z.array(z.string()).default([]),
  ignoredRoles: z.array(z.string()).default([]),
  customCards: z.boolean().default(true),
  background: z.string().default('midnight'),
});

export type LevelingSettings = z.output<typeof guildSettings>;

export const levelingSettings: SettingsSlice<typeof guildSettings> = { name: 'leveling', guildSettings };
