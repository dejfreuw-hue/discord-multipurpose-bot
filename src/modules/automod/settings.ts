import { z } from 'zod';
import type { SettingsSlice } from '../../core/guild-settings.js';

export const FILTERS = ['invites', 'links', 'badWords', 'spam', 'mentions', 'caps', 'ghostPing'] as const;
export type FilterName = (typeof FILTERS)[number];

export const PUNISHMENTS = ['warn', 'timeout', 'kick', 'ban'] as const;
export type Punishment = (typeof PUNISHMENTS)[number];

export const automodConfig = z.object({
  noticeSeconds: z.number().int().min(0).max(60).default(6),
});

const strikes = (points: number) => z.number().int().min(0).max(10).default(points);

const step = z.object({
  strikes: z.number().int().min(1).max(100),
  action: z.enum(PUNISHMENTS),
  /** Milliseconds, for timeouts and temporary bans. */
  duration: z.number().int().positive().nullable().default(null),
});

export type LadderStep = z.output<typeof step>;

const guildSettings = z.object({
  whitelistRoles: z.array(z.string()).default([]),
  whitelistChannels: z.array(z.string()).default([]),
  exemptStaff: z.boolean().default(true),
  notify: z.boolean().default(true),
  strikeDecay: z.number().int().positive().default(24 * 60 * 60 * 1000),
  ladder: z.array(step).default([
    { strikes: 3, action: 'timeout', duration: 10 * 60 * 1000 },
    { strikes: 5, action: 'timeout', duration: 60 * 60 * 1000 },
    { strikes: 8, action: 'kick', duration: null },
  ]),
  filters: z
    .object({
      invites: z
        .object({ enabled: z.boolean().default(true), strikes: strikes(1), allowOwnServer: z.boolean().default(true) })
        .prefault({}),
      links: z
        .object({
          enabled: z.boolean().default(false),
          strikes: strikes(1),
          allowedDomains: z.array(z.string()).default(['tenor.com', 'giphy.com', 'youtube.com', 'youtu.be', 'discord.com']),
        })
        .prefault({}),
      badWords: z
        .object({ enabled: z.boolean().default(false), strikes: strikes(1), words: z.array(z.string()).default([]) })
        .prefault({}),
      spam: z
        .object({
          enabled: z.boolean().default(true),
          strikes: strikes(1),
          messages: z.number().int().min(2).max(50).default(6),
          seconds: z.number().int().min(1).max(120).default(5),
          duplicates: z.number().int().min(2).max(50).default(4),
        })
        .prefault({}),
      mentions: z
        .object({ enabled: z.boolean().default(true), strikes: strikes(2), limit: z.number().int().min(2).max(50).default(6) })
        .prefault({}),
      caps: z
        .object({
          enabled: z.boolean().default(false),
          strikes: strikes(1),
          percent: z.number().int().min(50).max(100).default(70),
          minLength: z.number().int().min(4).max(500).default(12),
        })
        .prefault({}),
      ghostPing: z
        .object({ enabled: z.boolean().default(true), strikes: strikes(0), seconds: z.number().int().min(5).max(600).default(30) })
        .prefault({}),
    })
    .prefault({}),
});

export type AutomodSettings = z.output<typeof guildSettings>;

export const automodSettings: SettingsSlice<typeof guildSettings> = { name: 'automod', guildSettings };
