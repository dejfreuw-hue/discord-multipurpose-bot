import mongoose from 'mongoose';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Bot } from '../src/core/bot.js';
import { GuildSettings } from '../src/core/guild-settings.js';
import { I18n } from '../src/core/i18n.js';
import { fromRoot } from '../src/core/paths.js';
import { Panel } from '../src/core/ui/panel.js';
import { checkBirthdays } from '../src/modules/community/birthdays/celebrate.js';
import { BirthdayModel } from '../src/modules/community/birthdays/model.js';
import { birthdaySettings } from '../src/modules/community/birthdays/settings.js';

// Needs a real MongoDB. Run with MONGODB_TEST_URI=mongodb://127.0.0.1:27017/bot-test npm test
const uri = process.env.MONGODB_TEST_URI;

describe.skipIf(!uri)('birthday clock', () => {
  const logger = pino({ level: 'silent' });
  const guildId = `b${Date.now()}`;
  const send = vi.fn(async () => ({}));
  const addRole = vi.fn(async () => undefined);
  const removeRole = vi.fn(async () => undefined);
  const member = { id: 'u1', displayName: 'Sam', roles: { add: addRole, remove: removeRole } };
  const guild = {
    id: guildId,
    name: 'Lounge',
    members: { fetch: vi.fn(async () => member) },
    channels: { cache: new Map([['chan', { isSendable: () => true, send }]]) },
  };
  const settings = new GuildSettings(logger);
  const bot = {
    logger,
    settings,
    i18n: I18n.fromDirectory(fromRoot('locales'), 'en'),
    config: { bot: { color: 0 } },
    guildLocale: () => 'en',
    isEnabled: () => true,
    panel: () => new Panel(0, true),
    client: { guilds: { cache: new Map([[guildId, guild]]) } },
  } as unknown as Bot;

  beforeAll(async () => {
    await mongoose.connect(uri!);
    await settings.updateModule(guildId, birthdaySettings, { channelId: 'chan', roleId: 'role', timeZone: 'Asia/Tokyo' });
    await BirthdayModel.create({ guildId, userId: 'u1', month: 3, day: 11, year: 2000 });
  });
  afterAll(async () => {
    await BirthdayModel.deleteMany({ guildId });
    await mongoose.disconnect();
  });

  it('waits for midnight in the server timezone', async () => {
    await checkBirthdays(bot, new Date('2026-03-10T14:00:00Z'));
    expect(send).not.toHaveBeenCalled();
  });

  it('announces once with the age and gives the role', async () => {
    // 15:30 UTC is 00:30 on March 11 in Tokyo.
    const now = new Date('2026-03-10T15:30:00Z');
    await Promise.all([checkBirthdays(bot, now), checkBirthdays(bot, now)]);
    await checkBirthdays(bot, new Date('2026-03-10T20:00:00Z'));
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(send.mock.calls[0])).toContain('turning **26**');
    expect(addRole).toHaveBeenCalledTimes(1);
    const doc = await BirthdayModel.findOne({ guildId, userId: 'u1' }).lean();
    // Role ends at Tokyo midnight, 15:00 UTC on March 11.
    expect(doc?.roleUntil?.toISOString()).toBe('2026-03-11T15:00:00.000Z');
  });

  it('takes the role back after the day ends', async () => {
    await checkBirthdays(bot, new Date('2026-03-11T15:01:00Z'));
    expect(removeRole).toHaveBeenCalledWith('role', expect.any(String));
    expect((await BirthdayModel.findOne({ guildId, userId: 'u1' }).lean())?.roleUntil).toBeNull();
  });
});
