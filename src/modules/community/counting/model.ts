import { Schema, model } from 'mongoose';

export interface CountingStateDoc {
  guildId: string;
  current: number;
  lastUserId: string | null;
  lastMessageId: string | null;
  highScore: number;
}

const schema = new Schema<CountingStateDoc>({
  guildId: { type: String, required: true, unique: true },
  current: { type: Number, default: 0 },
  lastUserId: { type: String, default: null },
  lastMessageId: { type: String, default: null },
  highScore: { type: Number, default: 0 },
});

export const CountingStateModel = model<CountingStateDoc>('CountingState', schema);

export async function countingState(guildId: string): Promise<CountingStateDoc> {
  return CountingStateModel.findOneAndUpdate(
    { guildId },
    { $setOnInsert: { guildId } },
    { upsert: true, returnDocument: 'after', lean: true },
  ) as Promise<CountingStateDoc>;
}

/**
 * Moves the count from `value - 1` to `value`. Only succeeds if nobody else counted in between,
 * so two people posting the same number at once can't both get it.
 */
export async function advanceCount(guildId: string, value: number, userId: string, messageId: string, allowTwice: boolean): Promise<boolean> {
  const filter = { guildId, current: value - 1, ...(allowTwice ? {} : { lastUserId: { $ne: userId } }) };
  const result = await CountingStateModel.updateOne(filter, {
    $set: { current: value, lastUserId: userId, lastMessageId: messageId },
    $max: { highScore: value },
  });
  return result.modifiedCount === 1;
}

export async function resetCount(guildId: string, to = 0): Promise<void> {
  await CountingStateModel.updateOne({ guildId }, { $set: { current: to, lastUserId: null, lastMessageId: null } }, { upsert: true });
}
