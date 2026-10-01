import { EconomyProfileModel, type EconomyProfileDoc } from './models.js';

/*
 * Every balance change is one conditional update, so the check ("has enough") and the change
 * happen atomically in MongoDB. Two commands racing each other can't spend the same coins twice.
 */

type TimeField = 'lastDaily' | 'lastWeekly' | 'lastWork' | 'lastRob';

export async function profile(guildId: string, userId: string, startBalance: number): Promise<EconomyProfileDoc> {
  const doc = await EconomyProfileModel.findOneAndUpdate(
    { guildId, userId },
    { $setOnInsert: { wallet: startBalance } },
    { upsert: true, returnDocument: 'after', lean: true },
  );
  return doc!;
}

/** Takes `amount` from the wallet if it's there. Returns false (and changes nothing) otherwise. */
export async function debit(guildId: string, userId: string, amount: number): Promise<boolean> {
  const result = await EconomyProfileModel.updateOne({ guildId, userId, wallet: { $gte: amount } }, { $inc: { wallet: -amount } });
  return result.modifiedCount === 1;
}

export async function credit(guildId: string, userId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await EconomyProfileModel.updateOne({ guildId, userId }, { $inc: { wallet: amount } }, { upsert: true });
}

export async function deposit(guildId: string, userId: string, amount: number, bankLimit: number): Promise<boolean> {
  const filter: Record<string, unknown> = { guildId, userId, wallet: { $gte: amount } };
  if (bankLimit > 0) filter.bank = { $lte: bankLimit - amount };
  const result = await EconomyProfileModel.updateOne(filter, { $inc: { wallet: -amount, bank: amount } });
  return result.modifiedCount === 1;
}

export async function withdraw(guildId: string, userId: string, amount: number): Promise<boolean> {
  const result = await EconomyProfileModel.updateOne({ guildId, userId, bank: { $gte: amount } }, { $inc: { wallet: amount, bank: -amount } });
  return result.modifiedCount === 1;
}

/** Moves wallet money between members. The sender is debited first; the credit can't fail on funds. */
export async function transfer(guildId: string, from: string, to: string, amount: number): Promise<boolean> {
  if (!(await debit(guildId, from, amount))) return false;
  await credit(guildId, to, amount);
  return true;
}

/**
 * Claims a timed reward. Succeeds only if the last claim recorded in `field` is still the one
 * the caller read, so two simultaneous claims can't both pay out.
 */
export async function claim(
  guildId: string,
  userId: string,
  field: TimeField,
  previous: Date | null,
  reward: number,
  extra: Partial<EconomyProfileDoc> = {},
): Promise<boolean> {
  const result = await EconomyProfileModel.updateOne(
    { guildId, userId, [field]: previous },
    { $set: { [field]: new Date(), ...extra }, $inc: { wallet: reward } },
  );
  return result.modifiedCount === 1;
}

/** When a cooldown recorded in `last` ends, or null if it already has. */
export function readyAt(last: Date | null, cooldownMs: number, now = Date.now()): Date | null {
  if (!last) return null;
  const at = last.getTime() + cooldownMs;
  return at > now ? new Date(at) : null;
}

export async function addItem(guildId: string, userId: string, itemId: number): Promise<void> {
  const bumped = await EconomyProfileModel.updateOne({ guildId, userId, 'inventory.itemId': itemId }, { $inc: { 'inventory.$.quantity': 1 } });
  if (bumped.modifiedCount === 0) {
    await EconomyProfileModel.updateOne({ guildId, userId }, { $push: { inventory: { itemId, quantity: 1 } } });
  }
}
