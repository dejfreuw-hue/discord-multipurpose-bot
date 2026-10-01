import { z } from 'zod';
import type { SettingsSlice } from '../../core/guild-settings.js';

export const backupConfig = z.object({
  /** Backups each server can keep, not counting automatic ones. */
  maxPerGuild: z.number().int().min(1).max(100).default(10),
  autoIntervalHours: z.number().int().min(1).max(720).default(24),
  /** Automatic backups kept per server; older ones are deleted. */
  autoKeep: z.number().int().min(1).max(30).default(3),
});

const settingsSchema = z.object({
  auto: z.boolean().default(false),
});
export const backupSettings: SettingsSlice<typeof settingsSchema> = { name: 'backup', guildSettings: settingsSchema };
