import mongoose from 'mongoose';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GuildSettings } from '../src/core/guild-settings.js';
import { defineModule } from '../src/core/module.js';
import { GuildSettingsModel } from '../src/core/models/guild-settings.js';

// Needs a real MongoDB. Run with MONGODB_TEST_URI=mongodb://127.0.0.1:27017/bot-test npm test
const uri = process.env.MONGODB_TEST_URI;

const sample = defineModule({
  name: 'sample',
  toggleable: true,
  guildSettings: z.object({ channelId: z.string().nullable().default(null), limit: z.number().default(5) }),
});

describe.skipIf(!uri)('GuildSettings', () => {
  const store = new GuildSettings(pino({ level: 'silent' }));

  beforeAll(async () => {
    await mongoose.connect(uri!);
    await GuildSettingsModel.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('creates defaults on first access and shares concurrent loads', async () => {
    const [a, b] = await Promise.all([store.get('1'), store.get('1')]);
    expect(a).toBe(b);
    expect(a.staffRoles).toEqual([]);
    expect(await GuildSettingsModel.countDocuments({ guildId: '1' })).toBe(1);
  });

  it('writes through to the database', async () => {
    await store.update('2', { locale: 'de', staffRoles: ['10'] });
    store.evict('2');
    const fresh = await store.get('2');
    expect(fresh.locale).toBe('de');
    expect(fresh.staffRoles).toEqual(['10']);
  });

  it('fills module defaults and merges partial updates', async () => {
    expect(await store.module('3', sample)).toEqual({ channelId: null, limit: 5 });
    await store.updateModule('3', sample, { limit: 9 });
    store.evict('3');
    expect(await store.module('3', sample)).toEqual({ channelId: null, limit: 9 });
  });

  it('falls back to defaults when stored data no longer fits the schema', async () => {
    await GuildSettingsModel.updateOne({ guildId: '4' }, { $set: { 'modules.sample': { limit: 'many' } } }, { upsert: true });
    expect(await store.module('4', sample)).toEqual({ channelId: null, limit: 5 });
  });

  it('toggles modules per guild', async () => {
    await store.setModuleEnabled('5', 'sample', false);
    expect((await store.get('5')).disabledModules).toEqual(['sample']);
    await store.setModuleEnabled('5', 'sample', true);
    expect((await store.get('5')).disabledModules).toEqual([]);
  });
});
