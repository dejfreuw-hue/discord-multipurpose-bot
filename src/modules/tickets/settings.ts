import { z } from 'zod';
import type { SettingsSlice } from '../../core/guild-settings.js';

export const ticketsConfig = z.object({
  /** Most messages saved into one transcript. Older messages beyond this are left out. */
  transcriptLimit: z.number().int().min(100).max(20_000).default(5000),
  inactivityCheckMinutes: z.number().int().min(1).max(1440).default(10),
});

const guildSettings = z.object({
  /** Discord category new ticket channels go into. */
  categoryId: z.string().nullable().default(null),
  transcriptChannelId: z.string().nullable().default(null),
  supportRoles: z.array(z.string()).default([]),
  maxOpenPerUser: z.number().int().min(1).max(10).default(1),
  namePattern: z.string().max(60).default('ticket-{number}'),
  dmTranscript: z.boolean().default(true),
  /** Hours without messages before the owner is reminded. 0 turns reminders off. */
  reminderHours: z.number().int().min(0).max(720).default(24),
  /** Hours without messages before the ticket closes itself. 0 never closes. */
  autoCloseHours: z.number().int().min(0).max(2160).default(0),
  modmail: z
    .object({
      enabled: z.boolean().default(false),
      /** Falls back to the ticket category when not set. */
      categoryId: z.string().nullable().default(null),
      blocked: z.array(z.string()).default([]),
    })
    .prefault({}),
});

export type TicketSettings = z.output<typeof guildSettings>;

export const ticketSettings: SettingsSlice<typeof guildSettings> = { name: 'tickets', guildSettings };
