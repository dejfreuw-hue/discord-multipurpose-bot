import { z } from 'zod';

export const hexColor = z
  .string()
  .regex(/^#?[0-9a-f]{6}$/i, 'must be a hex colour like "#5865F2" (in quotes)')
  .transform((v) => Number.parseInt(v.replace('#', ''), 16));

export const snowflake = z
  .string({ error: 'must be a Discord ID in quotes, e.g. "123456789012345678"' })
  .regex(/^\d{17,20}$/, 'must be a Discord ID (17-20 digits). Turn on Developer Mode in Discord, right-click, Copy ID');

const optionalUrl = z.union([z.literal(''), z.url({ error: 'must be a full link starting with https://' })]);

export const configSchema = z.strictObject({
  bot: z.strictObject({
    name: z.string().min(1).max(32),
    owners: z.array(snowflake).default([]),
    locale: z.string().default('en'),
    color: hexColor.default(0x5865f2),
    presence: z
      .strictObject({
        status: z.enum(['online', 'idle', 'dnd', 'invisible']).default('online'),
        activity: z.enum(['playing', 'listening', 'watching', 'competing', 'custom', 'none']).default('watching'),
        text: z.string().max(128).default('/help'),
      })
      .prefault({}),
    supportServer: optionalUrl.default(''),
    website: optionalUrl.default(''),
  }),
  commands: z
    .strictObject({
      autoRegister: z.boolean().default(true),
      devGuildId: z.union([z.literal(''), snowflake]).default(''),
      defaultCooldown: z.number().min(0).default(3),
      cooldowns: z.record(z.string(), z.number().min(0)).default({}),
    })
    .prefault({}),
  ui: z
    .strictObject({
      componentsV2: z.boolean().default(true),
    })
    .prefault({}),
  logging: z
    .strictObject({
      level: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
      pretty: z.boolean().default(true),
      dir: z.string().default('logs'),
      retainFiles: z.number().int().min(1).default(14),
      maxSize: z
        .string()
        .regex(/^\d+[kmg]$/i, 'must look like "10m" (k, m or g)')
        .default('10m'),
    })
    .prefault({}),
  modules: z.record(z.string(), z.unknown()).default({}),
});

export type Config = z.output<typeof configSchema>;
