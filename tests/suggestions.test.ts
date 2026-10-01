import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordVote, SuggestionModel } from '../src/modules/community/suggestions/model.js';
import { approval } from '../src/modules/community/suggestions/votes.js';

describe('approval', () => {
  it('is null without votes', () => {
    expect(approval(0, 0)).toBeNull();
  });

  it('rounds to a whole percentage', () => {
    expect(approval(2, 1)).toBe(67);
    expect(approval(0, 4)).toBe(0);
  });
});

// Needs a real MongoDB. Run with MONGODB_TEST_URI=mongodb://127.0.0.1:27017/bot-test npm test
const uri = process.env.MONGODB_TEST_URI;

describe.skipIf(!uri)('recordVote', () => {
  const guildId = `s${Date.now()}`;
  const votes = async () => SuggestionModel.findOne({ guildId, number: 1 }).lean();

  beforeAll(async () => {
    await mongoose.connect(uri!);
    await SuggestionModel.create({ guildId, number: 1, authorId: 'x', content: 'more emojis', channelId: 'c' });
  });
  afterAll(async () => {
    await SuggestionModel.deleteMany({ guildId });
    await mongoose.disconnect();
  });

  it('adds, moves and removes a vote', async () => {
    expect(await recordVote(guildId, 1, 'a', 'up')).toBe('up');
    expect(await votes()).toMatchObject({ up: ['a'], down: [] });
    expect(await recordVote(guildId, 1, 'a', 'down')).toBe('down');
    expect(await votes()).toMatchObject({ up: [], down: ['a'] });
    expect(await recordVote(guildId, 1, 'a', 'down')).toBe('none');
    expect(await votes()).toMatchObject({ up: [], down: [] });
  });

  it('keeps every vote when many members click at once', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `m${i}`);
    await Promise.all(ids.map((id) => recordVote(guildId, 1, id, 'up')));
    expect((await votes())?.up).toHaveLength(30);
  });

  it('refuses votes on closed or missing suggestions', async () => {
    await SuggestionModel.updateOne({ guildId, number: 1 }, { status: 'denied' });
    expect(await recordVote(guildId, 1, 'z', 'up')).toBeNull();
    expect(await recordVote(guildId, 99, 'z', 'up')).toBeNull();
  });
});
