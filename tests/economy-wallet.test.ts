import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EconomyProfileModel } from '../src/modules/economy/models.js';
import { addItem, claim, credit, debit, deposit, profile, readyAt, transfer, withdraw } from '../src/modules/economy/wallet.js';

describe('readyAt', () => {
  it('returns the end of a running cooldown, or null', () => {
    expect(readyAt(null, 1000)).toBeNull();
    expect(readyAt(new Date(0), 1000, 500)?.getTime()).toBe(1000);
    expect(readyAt(new Date(0), 1000, 1000)).toBeNull();
  });
});

// Needs a real MongoDB. Run with MONGODB_TEST_URI=mongodb://127.0.0.1:27017/bot-test npm test
const uri = process.env.MONGODB_TEST_URI;

describe.skipIf(!uri)('wallet', () => {
  const g = `g${Date.now()}`;
  const balance = async (userId: string) => (await EconomyProfileModel.findOne({ guildId: g, userId }).lean())!;

  beforeAll(async () => {
    await mongoose.connect(uri!);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('creates profiles with the starting balance once', async () => {
    expect((await profile(g, 'a', 100)).wallet).toBe(100);
    expect((await profile(g, 'a', 999)).wallet).toBe(100);
  });

  it('never overdraws, even with concurrent debits', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => debit(g, 'a', 30)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect((await balance('a')).wallet).toBe(10);
  });

  it('moves money between wallet and bank within the limit', async () => {
    await credit(g, 'a', 490);
    expect(await deposit(g, 'a', 400, 300)).toBe(false);
    expect(await deposit(g, 'a', 300, 300)).toBe(true);
    expect(await deposit(g, 'a', 1, 300)).toBe(false);
    expect(await withdraw(g, 'a', 301)).toBe(false);
    expect(await withdraw(g, 'a', 100)).toBe(true);
    expect(await balance('a')).toMatchObject({ wallet: 300, bank: 200 });
  });

  it('transfers only what the sender has', async () => {
    await profile(g, 'b', 0);
    expect(await transfer(g, 'a', 'b', 500)).toBe(false);
    expect(await transfer(g, 'a', 'b', 250)).toBe(true);
    expect((await balance('a')).wallet).toBe(50);
    expect((await balance('b')).wallet).toBe(250);
  });

  it('pays a timed reward once when claims race', async () => {
    const before = await profile(g, 'c', 0);
    const results = await Promise.all(Array.from({ length: 5 }, () => claim(g, 'c', 'lastDaily', before.lastDaily, 500, { dailyStreak: 1 })));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await balance('c')).toMatchObject({ wallet: 500, dailyStreak: 1 });
  });

  it('stacks inventory items', async () => {
    await addItem(g, 'c', 7);
    await addItem(g, 'c', 7);
    await addItem(g, 'c', 8);
    expect((await balance('c')).inventory).toEqual([
      { itemId: 7, quantity: 2 },
      { itemId: 8, quantity: 1 },
    ]);
  });
});
