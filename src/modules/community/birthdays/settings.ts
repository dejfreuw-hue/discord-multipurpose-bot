import { z } from 'zod';
import type { SettingsSlice } from '../../../core/guild-settings.js';

const settingsSchema = z.object({
  channelId: z.string().nullable().default(null),
  /** Given for the member's birthday and taken away at the end of their day. */
  roleId: z.string().nullable().default(null),
  /** Custom announcement; null uses the translated default. Supports {user}, {username}, {server} and {age}. */
  message: z.string().max(1000).nullable().default(null),
  timeZone: z.string().default('UTC'),
});
export const birthdaySettings: SettingsSlice<typeof settingsSchema> = { name: 'birthdays', guildSettings: settingsSchema };
