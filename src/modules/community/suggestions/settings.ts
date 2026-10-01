import { z } from 'zod';
import type { SettingsSlice } from '../../../core/guild-settings.js';

const settingsSchema = z.object({
  channelId: z.string().nullable().default(null),
  /** Open a discussion thread on every suggestion. */
  threads: z.boolean().default(true),
  /** Tell the author by DM when staff decide. */
  dmAuthor: z.boolean().default(true),
});
export const suggestionSettings: SettingsSlice<typeof settingsSchema> = { name: 'suggestions', guildSettings: settingsSchema };
