import { Collection } from 'discord.js';
import mongoose from 'mongoose';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Bot } from '../src/core/bot.js';
import { UserError } from '../src/core/errors.js';
import { GuildSettings } from '../src/core/guild-settings.js';
import { I18n } from '../src/core/i18n.js';
import { fromRoot } from '../src/core/paths.js';
import { Panel } from '../src/core/ui/panel.js';
import { endGiveaway, toggleEntry } from '../src/modules/community/giveaways/giveaway.js';
import { GiveawayModel } from '../src/modules/community/giveaways/model.js';

// Needs a real MongoDB. Run with MONGODB_TEST_URI=mongodb://127.0.0.1:27017/bot-test npm test
const uri = process.env.MONGODB_TEST_URI;

describe.skipIf(!uri)('giveaway flow', () => {
  const logger = pino({ level: 'silent' });
  const guildId = `g${Date.now()}`;
  const send = vi.fn(async () => ({}));
  const members = new Collection(
    ['a', 'b', 'c'].map((id) => [id, { id, premiumSince: null, roles: { cache: new Collection() } }] as const),
  );
  const guild = { id: guildId, members: { fetch: vi.fn(async () => members) } };
  const bot = {
    logger,
    settings: new GuildSettings(logger),
    i18n: I18n.fromDirectory(fromRoot('locales'), 'en'),
    config: { bot: { locale: 'en', color: 0 } },
    guildLocale: () => 'en',
    panel: () => new Panel(0, true),
    moduleConfig: () => ({ curve: { quadratic: 5, linear: 50, base: 100 } }),
    client: {
      guilds: { cache: new Map([[guildId, guild]]) },
      channels: { cache: new Map([['chan', { isSendable: () => true, isTextBased: () => true, isDMBased: () => false, send, messages: { fetch: async () => null } }]]) },
    },
  } as unknown as Bot;

  const base = {
    guildId,
    channelId: 'chan',
    hostId: 'host',
    prize: 'Nitro',
    winnerCount: 2,
    requirements: { roleId: null, minAccountDays: 30, minServerDays: 0, minLevel: 0 },
    bonus: { boosterEntries: 0, bonusRoles: [] },
  };

  beforeAll(async () => {
    await mongoose.connect(uri!);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('checks requirements on entry and lets members leave again', async () => {
    await GiveawayModel.create({ ...base, giveawayId: 1, endsAt: new Date(Date.now() + 60_000) });
    const fresh = { id: 'new', guild, user: { createdTimestamp: Date.now() - 86_400_000 }, roles: { cache: new Collection() } } as never;
    await expect(toggleEntry(bot, fresh, 1)).rejects.toBeInstanceOf(UserError);

    const old = { id: 'old', guild, user: { createdTimestamp: Date.now() - 400 * 86_400_000 }, roles: { cache: new Collection() } } as never;
    expect(await toggleEntry(bot, old, 1)).toBe(true);
    expect(await toggleEntry(bot, old, 1)).toBe(false);
    expect((await GiveawayModel.findOne({ guildId, giveawayId: 1 }).lean())?.entrants).toEqual([]);
  });

  it('draws exactly once when ended twice at the same time', async () => {
    await GiveawayModel.create({ ...base, giveawayId: 2, endsAt: new Date(Date.now() - 1000), entrants: ['a', 'b', 'c'] });
    const g = (await GiveawayModel.findOne({ guildId, giveawayId: 2 }).lean())!;
    const [first, second] = await Promise.all([endGiveaway(bot, g), endGiveaway(bot, g)]);
    const drawn = [first, second].filter((w) => w.length > 0);
    expect(drawn).toHaveLength(1);
    expect(new Set(drawn[0]).size).toBe(2);
    const saved = (await GiveawayModel.findOne({ guildId, giveawayId: 2 }).lean())!;
    expect(saved.status).toBe('ended');
    expect(saved.winners).toEqual(drawn[0]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
