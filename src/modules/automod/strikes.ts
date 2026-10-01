import { Schema, model } from 'mongoose';
import type { FilterName } from './settings.js';

interface StrikeDoc {
  guildId: string;
  userId: string;
  filter: FilterName;
  points: number;
  expiresAt: Date;
}

const schema = new Schema<StrikeDoc>(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    filter: { type: String, required: true },
    points: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.index({ guildId: 1, userId: 1, expiresAt: 1 });
// Mongo removes decayed strikes on its own. Its TTL sweep runs about once a minute, so
// queries still filter on expiresAt instead of trusting that documents are gone.
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const StrikeModel = model<StrikeDoc>('AutomodStrike', schema);

export async function activeStrikes(guildId: string, userId: string): Promise<number> {
  const [result] = await StrikeModel.aggregate<{ total: number }>([
    { $match: { guildId, userId, expiresAt: { $gt: new Date() } } },
    { $group: { _id: null, total: { $sum: '$points' } } },
  ]);
  return result?.total ?? 0;
}

/** Adds strikes and returns the member's active total before and after. */
export async function addStrikes(
  guildId: string,
  userId: string,
  filter: FilterName,
  points: number,
  decayMs: number,
): Promise<{ before: number; after: number }> {
  const before = await activeStrikes(guildId, userId);
  if (points <= 0) return { before, after: before };
  await StrikeModel.create({ guildId, userId, filter, points, expiresAt: new Date(Date.now() + decayMs) });
  return { before, after: before + points };
}

export async function strikeBreakdown(guildId: string, userId: string) {
  return StrikeModel.find({ guildId, userId, expiresAt: { $gt: new Date() } })
    .sort({ expiresAt: 1 })
    .lean();
}

export async function clearStrikes(guildId: string, userId: string): Promise<number> {
  const { deletedCount } = await StrikeModel.deleteMany({ guildId, userId });
  return deletedCount;
}
