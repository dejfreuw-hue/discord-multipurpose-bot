import mongoose from 'mongoose';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Bot } from '../src/core/bot.js';
import { GuildSettings } from '../src/core/guild-settings.js';
import { I18n } from '../src/core/i18n.js';
import { fromRoot } from '../src/core/paths.js';
import { Panel } from '../src/core/ui/panel.js';
import { createCase } from '../src/modules/moderation/cases.js';
import { CaseModel } from '../src/modules/moderation/models/case.js';

// Needs a real MongoDB. Run with MONGODB_TEST_URI=mongodb://127.0.0.1:27017/bot-test npm test
const uri = process.env.MONGODB_TEST_URI;

describe.skipIf(!uri)('createCase', () => {
  const logger = pino({ level: 'silent' });
  const bot = {
    logger,
    i18n: I18n.fromDirectory(fromRoot('locales'), 'en'),
    settings: new GuildSettings(logger),
    config: { bot: { locale: 'en', color: 0 } },
    guildLocale: () => 'en',
    panel: (color = 0) => new Panel(color, true),
  } as unknown as Bot;
  const guild = { id: `g${Date.now()}`, channels: { cache: new Map() }, members: { me: null } } as never;
  const user = { id: '1', tag: 'user' } as never;
  const moderator = { id: '2', tag: 'mod' } as never;

  beforeAll(async () => {
    await mongoose.connect(uri!);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('numbers cases per guild without gaps or duplicates under concurrency', async () => {
    const created = await Promise.all(
      Array.from({ length: 10 }, () => createCase(bot, guild, { type: 'warn', user, moderator, reason: null })),
    );
    expect(created.map((c) => c.caseId).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('marks temporary bans active with an expiry', async () => {
    const entry = await createCase(bot, guild, { type: 'ban', user, moderator, reason: 'spam', duration: 60_000 });
    expect(entry.active).toBe(true);
    expect(entry.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    const permanent = await createCase(bot, guild, { type: 'ban', user, moderator, reason: null });
    expect(permanent.active).toBe(false);
    expect(await CaseModel.countDocuments({ guildId: (guild as { id: string }).id })).toBe(12);
  });
});
