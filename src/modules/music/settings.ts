import { z } from 'zod';
import type { SettingsSlice } from '../../core/guild-settings.js';

export const musicConfig = z.object({
  /** Where plain-text searches go. Needs the matching Lavalink plugin (YouTube plugin, LavaSrc). */
  defaultSearch: z.enum(['ytsearch', 'ytmsearch', 'scsearch', 'spsearch', 'dzsearch', 'amsearch']).default('ytsearch'),
  /** Leave after the queue has been empty this long. */
  idleSeconds: z.number().int().min(10).max(3600).default(180),
  /** Leave after being alone in the voice channel this long. */
  emptyChannelSeconds: z.number().int().min(10).max(3600).default(120),
  maxQueue: z.number().int().min(10).max(10_000).default(500),
});

const guildSettings = z.object({
  /** When set, only these roles (plus staff) control playback for everyone. */
  djRoles: z.array(z.string()).default([]),
  defaultVolume: z.number().int().min(1).max(150).default(80),
  alwaysOn: z.boolean().default(false),
  /** Post a now-playing message with controls when a track starts. */
  announce: z.boolean().default(true),
});

export type MusicSettings = z.output<typeof guildSettings>;

export const musicSettings: SettingsSlice<typeof guildSettings> = { name: 'music', guildSettings };
