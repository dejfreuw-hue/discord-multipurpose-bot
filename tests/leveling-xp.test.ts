import mongoose from 'mongoose';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Bot } from '../src/core/bot.js';
import { GuildSettings } from '../src/core/guild-settings.js';
import { I18n } from '../src/core/i18n.js';
import { fromRoot } from '../src/core/paths.js';
import { Panel } from '../src/core/ui/panel.js';
import { ProfileModel } from '../src/modules/leveling/models.js';
import { levelingSettings } from '../src/modules/leveling/settings.js';
import { grantXp, setXp } from '../src/modules/leveling/xp.js';

// Needs a real MongoDB. Run with MONGODB_TEST_URI=mongodb://127.0.0.1:27017/bot-test npm test
const uri = process.env.MONGODB_TEST_URI;

describe.skipIf(!uri)('grantXp', () => {
  const logger = pino({ level: 'silent' });
  const settings = new GuildSettings(logger);
  const bot = {
    logger,
    settings,
    i18n: I18n.fromDirectory(fromRoot('locales'), 'en'),
    config: { bot: { locale: 'en', color: 0 }, moduleSettings: new Map([['leveling', { curve: { quadratic: 5, linear: 50, base: 100 } }]]) },
    moduleConfig: () => ({ curve: { quadratic: 5, linear: 50, base: 100 } }),
    guildLocale: () => 'en',
    panel: () => new Panel(0, true),
  } as unknown as Bot;

  const guildId = `g${Date.now()}`;
  const held = new Set<string>();
  const roles = new Map([
    ['r5', { id: 'r5', managed: false }],
    ['r1', { id: 'r1', managed: false }],
  ]);
  const me = { permissions: { has: () => true }, roles: { highest: { comparePositionTo: () => 1 } } };
  const member = {
    id: 'u1',
    displayName: 'Ana',
    toString: () => '<@u1>',
    send: vi.fn(),
    guild: { id: guildId, members: { me }, roles: { cache: roles }, channels: { cache: new Map() } },
    roles: {
      cache: { has: (id: string) => held.has(id) },
      add: vi.fn(async (ids: string[]) => ids.forEach((id) => held.add(id))),
      remove: vi.fn(async (ids: string[]) => ids.forEach((id) => held.delete(id))),
    },
  } as never;
  const channel = { isSendable: () => true, send: vi.fn(async () => undefined) } as never;

  beforeAll(async () => {
    await mongoose.connect(uri!);
    await settings.updateModule(guildId, levelingSettings, {
      rewards: [
        { level: 1, roleId: 'r1' },
        { level: 5, roleId: 'r5' },
      ],
      stackRewards: false,
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('announces a level-up exactly once even when grants race', async () => {
    await setXp(bot, member, 90);
    await Promise.all(Array.from({ length: 8 }, () => grantXp(bot, member, 5, 'message', channel)));
    const profile = await ProfileModel.findOne({ guildId, userId: 'u1' }).lean();
    expect(profile?.xp).toBe(130);
    expect(profile?.level).toBe(1);
    expect((channel as { send: ReturnType<typeof vi.fn> }).send).toHaveBeenCalledTimes(1);
    expect(held.has('r1')).toBe(true);
  });

  it('counts messages and voice minutes separately', async () => {
    await grantXp(bot, member, 1, 'voice', null);
    const profile = await ProfileModel.findOne({ guildId, userId: 'u1' }).lean();
    expect(profile?.messages).toBe(8);
    expect(profile?.voiceMinutes).toBe(1);
  });

  it('swaps reward roles when not stacking and removes them when XP drops', async () => {
    await setXp(bot, member, 2000);
    expect([...held].sort()).toEqual(['r5']);
    await setXp(bot, member, 0);
    expect(held.size).toBe(0);
  });
});
