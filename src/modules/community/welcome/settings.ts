import { z } from 'zod';
import type { SettingsSlice } from '../../../core/guild-settings.js';

const event = (card: boolean) =>
  z
    .object({
      enabled: z.boolean().default(false),
      channelId: z.string().nullable().default(null),
      /** Template with {user}, {username}, {server} and {count}. Null uses the translated default. */
      message: z.string().max(1500).nullable().default(null),
      card: z.boolean().default(card),
    })
    .prefault({});

const guildSettings = z.object({
  join: event(true),
  leave: event(false),
  /** Also DM new members the join message. */
  dm: z.boolean().default(false),
  background: z.string().default('midnight'),
  color: z.number().int().nullable().default(null),
});

export type WelcomeSettings = z.output<typeof guildSettings>;

export const welcomeSettings: SettingsSlice<typeof guildSettings> = { name: 'welcome', guildSettings };
