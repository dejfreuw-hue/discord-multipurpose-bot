import { z } from 'zod';
import type { SettingsSlice } from '../../../core/guild-settings.js';
import { COUNTER_KINDS } from './counters.js';

const counterSchema = z.object({
  channelId: z.string(),
  kind: z.enum(COUNTER_KINDS),
  template: z.string().max(90),
});
export type Counter = z.infer<typeof counterSchema>;

const settingsSchema = z.object({
  counters: z.array(counterSchema).max(10).default([]),
});
export const serverStatsSettings: SettingsSlice<typeof settingsSchema> = { name: 'serverstats', guildSettings: settingsSchema };
