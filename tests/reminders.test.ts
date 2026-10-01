import mongoose, { Types } from 'mongoose';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Bot } from '../src/core/bot.js';
import { I18n } from '../src/core/i18n.js';
import { fromRoot } from '../src/core/paths.js';
import { Panel } from '../src/core/ui/panel.js';
import { deliverDue } from '../src/modules/reminders/deliver.js';
import { ReminderModel } from '../src/modules/reminders/model.js';
import { isLate, nextOccurrence } from '../src/modules/reminders/schedule.js';

const HOUR = 3_600_000;

describe('nextOccurrence', () => {
  const due = new Date('2026-01-01T09:00:00Z');

  it('moves one interval ahead when on time', () => {
    expect(nextOccurrence(due, 24 * HOUR, new Date('2026-01-01T09:00:05Z')).toISOString()).toBe('2026-01-02T09:00:00.000Z');
  });

  it('skips occurrences missed while offline and keeps the time of day', () => {
    expect(nextOccurrence(due, 24 * HOUR, new Date('2026-01-04T12:00:00Z')).toISOString()).toBe('2026-01-05T09:00:00.000Z');
  });

  it('is always in the future', () => {
    const now = new Date('2026-01-01T10:00:00Z');
    expect(nextOccurrence(due, HOUR, now).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('isLate', () => {
  it('ignores the normal polling delay', () => {
    const due = new Date('2026-01-01T09:00:00Z');
    expect(isLate(due, new Date('2026-01-01T09:00:30Z'))).toBe(false);
    expect(isLate(due, new Date('2026-01-01T09:10:00Z'))).toBe(true);
  });
});

// Needs a real MongoDB. Run with MONGODB_TEST_URI=mongodb://127.0.0.1:27017/bot-test npm test
const uri = process.env.MONGODB_TEST_URI;

describe.skipIf(!uri)('deliverDue', () => {
  const userId = `u${Date.now()}`;
  const dm = vi.fn(async () => ({}));
  const channelSend = vi.fn(async () => ({}));
  const guild = { id: 'g', channels: { cache: new Map([['c', { isSendable: () => true, send: channelSend }]]) } };
  const bot = {
    logger: pino({ level: 'silent' }),
    i18n: I18n.fromDirectory(fromRoot('locales'), 'en'),
    panel: () => new Panel(0, true),
    client: {
      guilds: { cache: new Map([['g', guild]]) },
      users: { fetch: async () => ({ send: dm }) },
    },
  } as unknown as Bot;
  const base = { userId, text: 'stretch', locale: 'en' };

  beforeAll(async () => {
    await mongoose.connect(uri!);
  });
  afterAll(async () => {
    await ReminderModel.deleteMany({ userId });
    await mongoose.disconnect();
  });

  it('delivers each due reminder once, even with overlapping checks', async () => {
    const now = new Date();
    await ReminderModel.create([
      { ...base, number: 1, guildId: 'g', channelId: 'c', dueAt: new Date(now.getTime() - 1000) },
      { ...base, number: 2, dueAt: new Date(now.getTime() - 1000) },
      { ...base, number: 3, dueAt: new Date(now.getTime() + HOUR) },
    ]);
    await Promise.all([deliverDue(bot, now), deliverDue(bot, now)]);
    expect(channelSend).toHaveBeenCalledTimes(1);
    expect(dm).toHaveBeenCalledTimes(1);
    const left = await ReminderModel.find({ userId, done: false }).lean();
    expect(left.map((r) => r.number)).toEqual([3]);
  });

  it('falls back to DM when the channel is gone', async () => {
    dm.mockClear();
    await ReminderModel.create({ ...base, number: 4, guildId: 'g', channelId: 'deleted', dueAt: new Date(Date.now() - 1000) });
    await deliverDue(bot, new Date());
    expect(dm).toHaveBeenCalledTimes(1);
  });

  it('moves repeating reminders forward instead of finishing them', async () => {
    const dueAt = new Date(Date.now() - 1000);
    const { _id } = await ReminderModel.create({ ...base, number: 5, dueAt, repeatMs: 24 * HOUR });
    await deliverDue(bot, new Date());
    const doc = await ReminderModel.findById(_id).lean();
    expect(doc?.done).toBe(false);
    expect(doc?.dueAt.getTime()).toBe(dueAt.getTime() + 24 * HOUR);
  });

  it('keeps finished one-off reminders only for the snooze window', async () => {
    const doc = await ReminderModel.findOne({ userId, number: 2 }).lean();
    expect(doc?.done).toBe(true);
    expect(doc?.expireAt).toBeInstanceOf(Date);
    expect(Types.ObjectId.isValid(String(doc?._id))).toBe(true);
  });
});
