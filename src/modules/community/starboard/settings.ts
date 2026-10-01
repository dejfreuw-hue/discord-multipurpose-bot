import { z } from 'zod';
import type { SettingsSlice } from '../../../core/guild-settings.js';

const settingsSchema = z.object({
  channelId: z.string().nullable().default(null),
  emoji: z.string().default('\u2B50'),
  threshold: z.number().int().min(1).max(100).default(3),
  /** Count the author's own reaction. */
  selfStar: z.boolean().default(false),
  ignoredChannelIds: z.array(z.string()).default([]),
});
export const starboardSettings: SettingsSlice<typeof settingsSchema> = { name: 'starboard', guildSettings: settingsSchema };
