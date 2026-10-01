import { z } from 'zod';
import type { SettingsSlice } from '../../core/guild-settings.js';

export const voiceConfig = z.object({
  /** Seconds a member has to wait between creating channels, so hopping in and out can't spam. */
  createCooldownSeconds: z.number().int().min(0).max(600).default(10),
});

export const hubSchema = z.object({
  channelId: z.string(),
  /** Category for new channels. Null uses the hub's own category. */
  categoryId: z.string().nullable().default(null),
  /** {user}, {count} and {game}. {game} needs the Presence intent; without it, it shows the name. */
  nameTemplate: z.string().min(1).max(100).default("{user}'s channel"),
  userLimit: z.number().int().min(0).max(99).default(0),
});

export type Hub = z.output<typeof hubSchema>;

const guildSettings = z.object({
  hubs: z.array(hubSchema).default([]),
});

export const voiceSettings: SettingsSlice<typeof guildSettings> = { name: 'voice', guildSettings };
