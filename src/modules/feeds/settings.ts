import { z } from 'zod';

export const feedsConfig = z.object({
  /** YouTube's feeds update every few minutes at best; checking more often only adds load. */
  youtubeIntervalMinutes: z.number().int().min(5).max(120).default(10),
  twitchIntervalSeconds: z.number().int().min(60).max(1800).default(120),
  maxPerGuild: z.number().int().min(1).max(200).default(25),
  /** Videos older than this are never announced, e.g. ones made public long after upload. */
  maxVideoAgeHours: z.number().int().min(1).max(720).default(48),
});
