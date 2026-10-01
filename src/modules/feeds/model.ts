import { Schema, model } from 'mongoose';

export type Platform = 'youtube' | 'twitch';

export interface FeedDoc {
  guildId: string;
  number: number;
  platform: Platform;
  /** YouTube channel ID or Twitch user ID. */
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  channelId: string;
  roleId: string | null;
  /** Custom announcement with {name}, {title}, {url} and {game}; null uses the default. */
  message: string | null;
  includeShorts: boolean;
  /** Recent YouTube video IDs already announced. */
  seen: string[];
  /** Twitch stream ID last announced, so one broadcast is only announced once. */
  lastStreamId: string | null;
}

const schema = new Schema<FeedDoc>(
  {
    guildId: { type: String, required: true },
    number: { type: Number, required: true },
    platform: { type: String, enum: ['youtube', 'twitch'], required: true },
    sourceId: { type: String, required: true },
    sourceName: { type: String, required: true },
    sourceUrl: { type: String, required: true },
    channelId: { type: String, required: true },
    roleId: { type: String, default: null },
    message: { type: String, default: null },
    includeShorts: { type: Boolean, default: true },
    seen: { type: [String], default: [] },
    lastStreamId: { type: String, default: null },
  },
  { timestamps: true },
);
schema.index({ guildId: 1, number: 1 }, { unique: true });
schema.index({ guildId: 1, platform: 1, sourceId: 1, channelId: 1 }, { unique: true });
schema.index({ platform: 1, sourceId: 1 });

export const FeedModel = model<FeedDoc>('Feed', schema);

/** Records a video as announced for this feed. False means another check got there first. */
export async function markSeen(feed: FeedDoc & { _id: unknown }, videoId: string): Promise<boolean> {
  const result = await FeedModel.updateOne({ _id: feed._id, seen: { $ne: videoId } }, { $push: { seen: { $each: [videoId], $slice: -50 } } });
  return result.modifiedCount === 1;
}

export async function markLive(feed: FeedDoc & { _id: unknown }, streamId: string): Promise<boolean> {
  const result = await FeedModel.updateOne({ _id: feed._id, lastStreamId: { $ne: streamId } }, { lastStreamId: streamId });
  return result.modifiedCount === 1;
}
