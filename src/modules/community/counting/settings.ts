import { z } from 'zod';
import type { SettingsSlice } from '../../../core/guild-settings.js';

export const countingConfig = z.object({
  /** Reaction on a correct number. */
  correctEmoji: z.string().default('\u2705'),
  /** Reaction on a number that sets a new server record. */
  recordEmoji: z.string().default('\u{1F3C6}'),
  /** Reaction on a wrong number. */
  wrongEmoji: z.string().default('\u274C'),
});

const settingsSchema = z.object({
  channelId: z.string().nullable().default(null),
  /** Start over from 1 after a mistake. When off, wrong numbers are deleted instead. */
  resetOnFail: z.boolean().default(true),
  /** Let the same member post two numbers in a row. */
  allowTwice: z.boolean().default(false),
  /** Keep messages that aren't numbers. When off, they are deleted. */
  allowChat: z.boolean().default(false),
});
export const countingSettings: SettingsSlice<typeof settingsSchema> = { name: 'counting', guildSettings: settingsSchema };
