import { z } from 'zod';
import type { SettingsSlice } from '../../core/guild-settings.js';

export const moderationConfig = z.object({
  hideCommands: z.boolean().default(true),
  expiryCheckSeconds: z.number().int().min(5).max(3600).default(30),
});

const guildSettings = z.object({
  logChannelId: z.string().nullable().default(null),
  dmUsers: z.boolean().default(true),
  requireReason: z.boolean().default(false),
  logExternal: z.boolean().default(true),
});

export type ModerationSettings = z.output<typeof guildSettings>;

export const moderationSettings: SettingsSlice<typeof guildSettings> = { name: 'moderation', guildSettings };
