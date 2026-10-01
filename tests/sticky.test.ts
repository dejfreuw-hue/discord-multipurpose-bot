import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Bot } from '../src/core/bot.js';
import { I18n } from '../src/core/i18n.js';
import { fromRoot } from '../src/core/paths.js';
import { Panel } from '../src/core/ui/panel.js';
import { StickyModel } from '../src/modules/community/sticky/model.js';
import { loadStickyChannels, scheduleRepost, stickyChannels } from '../src/modules/community/sticky/repost.js';

// Needs a real MongoDB. Run with MONGODB_TEST_URI=mongodb://127.0.0.1:27017/bot-test npm test
const uri = process.env.MONGODB_TEST_URI;

describe.skipIf(!uri)('sticky reposts', () => {
  const channelId = `ch${Date.now()}`;
  const bot = {
    i18n: I18n.fromDirectory(fromRoot('locales'), 'en'),
    settings: { get: async () => ({}) },
    guildLocale: () => 'en',
    panel: () => new Panel(0, true),
  } as unknown as Bot;
  let nextId = 0;
  const send = vi.fn(async () => ({ id: `m${++nextId}` }));
  const remove = vi.fn(async () => undefined);
  const channel = { id: channelId, guild: { id: 'g' }, send, messages: { delete: remove } } as never;

  beforeAll(async () => {
    await mongoose.connect(uri!);
    await StickyModel.create({ guildId: 'g', channelId, content: 'Read the rules first.', messageId: 'old' });
  });
  afterAll(async () => {
    await StickyModel.deleteMany({ channelId });
    await mongoose.disconnect();
  });

  it('loads channels with stickies', async () => {
    await loadStickyChannels();
    expect(stickyChannels.has(channelId)).toBe(true);
  });

  it('merges a burst of messages into one repost that replaces the old copy', async () => {
    scheduleRepost(bot, channel);
    scheduleRepost(bot, channel);
    scheduleRepost(bot, channel);
    await vi.waitFor(async () => expect((await StickyModel.findOne({ channelId }).lean())?.messageId).toBe('m1'));
    expect(send).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('old');
  });
});
