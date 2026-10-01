import { Schema, model } from 'mongoose';

interface UsageDoc {
  guildId: string;
  day: string;
  tokens: number;
  requests: number;
  expiresAt: Date;
}

const schema = new Schema<UsageDoc>({
  guildId: { type: String, required: true },
  day: { type: String, required: true },
  tokens: { type: Number, default: 0 },
  requests: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});
schema.index({ guildId: 1, day: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const UsageModel = model<UsageDoc>('AiUsage', schema);

const KEEP_DAYS = 40;

/** Budgets reset at midnight UTC, so every server shares the same day boundary. */
export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function usage(guildId: string): Promise<{ tokens: number; requests: number }> {
  const doc = await UsageModel.findOne({ guildId, day: today() }).lean();
  return { tokens: doc?.tokens ?? 0, requests: doc?.requests ?? 0 };
}

export async function recordUsage(guildId: string, tokens: number): Promise<void> {
  await UsageModel.updateOne(
    { guildId, day: today() },
    { $inc: { tokens, requests: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + KEEP_DAYS * 86_400_000) } },
    { upsert: true },
  );
}
