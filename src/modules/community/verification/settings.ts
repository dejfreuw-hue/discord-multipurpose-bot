import { z } from 'zod';
import type { SettingsSlice } from '../../../core/guild-settings.js';

const guildSettings = z.object({
  mode: z.enum(['button', 'captcha']).default('button'),
  /** Given when verified. */
  verifiedRoleId: z.string().nullable().default(null),
  /** Given on join and removed when verified, for servers that lock channels behind it. */
  unverifiedRoleId: z.string().nullable().default(null),
  /** Accounts younger than this many days can't verify. 0 turns the check off. */
  minAccountDays: z.number().int().min(0).max(365).default(0),
});

export type VerificationSettings = z.output<typeof guildSettings>;

export const verificationSettings: SettingsSlice<typeof guildSettings> = { name: 'verification', guildSettings };
