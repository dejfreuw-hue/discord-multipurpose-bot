import { Schema, model } from 'mongoose';

export const STATUSES = ['open', 'considered', 'approved', 'implemented', 'denied'] as const;
export type SuggestionStatus = (typeof STATUSES)[number];
export const CLOSED: readonly SuggestionStatus[] = ['approved', 'implemented', 'denied'];
const OPEN = STATUSES.filter((s) => !CLOSED.includes(s));

export interface SuggestionDoc {
  guildId: string;
  number: number;
  authorId: string;
  content: string;
  channelId: string;
  messageId: string | null;
  status: SuggestionStatus;
  up: string[];
  down: string[];
  reason: string | null;
  decidedBy: string | null;
}

const schema = new Schema<SuggestionDoc>(
  {
    guildId: { type: String, required: true },
    number: { type: Number, required: true },
    authorId: { type: String, required: true },
    content: { type: String, required: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: null },
    status: { type: String, enum: STATUSES, default: 'open' },
    up: { type: [String], default: [] },
    down: { type: [String], default: [] },
    reason: { type: String, default: null },
    decidedBy: { type: String, default: null },
  },
  { timestamps: true },
);
schema.index({ guildId: 1, number: 1 }, { unique: true });

export const SuggestionModel = model<SuggestionDoc>('Suggestion', schema);

/**
 * Toggles a member's vote: clicking the side they already voted for removes it, otherwise it moves
 * there. Returns the member's vote afterwards, or null when the suggestion is missing or closed.
 */
export async function recordVote(guildId: string, number: number, userId: string, side: 'up' | 'down'): Promise<'up' | 'down' | 'none' | null> {
  const filter = { guildId, number, status: { $in: OPEN } };
  const other = side === 'up' ? 'down' : 'up';
  // Conditional updates instead of read-modify-write so simultaneous voters never overwrite each other.
  const removed = await SuggestionModel.updateOne({ ...filter, [side]: userId }, { $pull: { [side]: userId } });
  if (removed.modifiedCount) return 'none';
  const added = await SuggestionModel.updateOne(filter, { $pull: { [other]: userId }, $addToSet: { [side]: userId } });
  return added.matchedCount ? side : null;
}
