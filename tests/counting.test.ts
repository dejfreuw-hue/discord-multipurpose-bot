import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { judgeCount, parseCount } from '../src/modules/community/counting/logic.js';
import { advanceCount, countingState, CountingStateModel, resetCount } from '../src/modules/community/counting/model.js';

describe('parseCount', () => {
  it('reads a leading number', () => {
    expect(parseCount('12')).toBe(12);
    expect(parseCount('  12  ')).toBe(12);
    expect(parseCount('12 almost there')).toBe(12);
  });

  it('ignores chat and numbers glued to text', () => {
    expect(parseCount('hello')).toBeNull();
    expect(parseCount('12abc')).toBeNull();
    expect(parseCount('-3')).toBeNull();
    expect(parseCount('1.5')).toBeNull();
  });
});

describe('judgeCount', () => {
  const state = { current: 4, lastUserId: 'a' };

  it('accepts the next number from someone else', () => {
    expect(judgeCount(state, 'b', 5, false)).toBe('ok');
  });

  it('rejects the wrong number before checking who sent it', () => {
    expect(judgeCount(state, 'a', 7, false)).toBe('wrongNumber');
  });

  it('rejects counting twice unless allowed', () => {
    expect(judgeCount(state, 'a', 5, false)).toBe('twice');
    expect(judgeCount(state, 'a', 5, true)).toBe('ok');
  });
});

// Needs a real MongoDB. Run with MONGODB_TEST_URI=mongodb://127.0.0.1:27017/bot-test npm test
const uri = process.env.MONGODB_TEST_URI;

describe.skipIf(!uri)('advanceCount', () => {
  const guildId = `c${Date.now()}`;

  beforeAll(async () => {
    await mongoose.connect(uri!);
    await countingState(guildId);
  });
  afterAll(async () => {
    await CountingStateModel.deleteMany({ guildId });
    await mongoose.disconnect();
  });

  it('lets only one of two simultaneous posts of the same number through', async () => {
    const results = await Promise.all([advanceCount(guildId, 1, 'a', 'm1', false), advanceCount(guildId, 1, 'b', 'm2', false)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await countingState(guildId)).current).toBe(1);
  });

  it('keeps the record through a reset', async () => {
    const last = (await countingState(guildId)).lastUserId;
    expect(await advanceCount(guildId, 2, last === 'a' ? 'b' : 'a', 'm3', false)).toBe(true);
    await resetCount(guildId);
    const state = await countingState(guildId);
    expect(state).toMatchObject({ current: 0, highScore: 2, lastUserId: null });
  });
});
