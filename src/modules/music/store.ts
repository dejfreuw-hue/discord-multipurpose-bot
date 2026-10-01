import type { QueueStoreManager, StoredQueue } from 'lavalink-client';
import { Schema, model } from 'mongoose';

const QueueModel = model<{ guildId: string; data: string }>(
  'MusicQueue',
  new Schema({ guildId: { type: String, required: true, unique: true }, data: { type: String, required: true } }, { timestamps: true }),
);

/**
 * Keeps every queue in MongoDB, so it survives a restart and can be picked up again.
 * It has to be a class: lavalink-client checks for these methods on the prototype.
 */
class MongoQueueStore implements QueueStoreManager {
  async get(guildId: string): Promise<string | undefined> {
    return (await QueueModel.findOne({ guildId }).lean())?.data;
  }

  async set(guildId: string, value: StoredQueue | string): Promise<void> {
    await QueueModel.updateOne({ guildId }, { data: this.stringify(value) }, { upsert: true });
  }

  async delete(guildId: string): Promise<void> {
    await QueueModel.deleteOne({ guildId });
  }

  stringify(value: StoredQueue | string): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  parse(value: StoredQueue | string): Partial<StoredQueue> {
    return typeof value === 'string' ? (JSON.parse(value) as Partial<StoredQueue>) : value;
  }
}

export const mongoQueueStore = new MongoQueueStore();

export interface SessionDoc {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string | null;
  volume: number;
  repeatMode: 'off' | 'track' | 'queue';
  paused: boolean;
  /** Playback position of the current track in ms, refreshed every few seconds. */
  position: number;
  filters: string[];
}

/** Everything besides the queue needed to pick playback up where it stopped. */
export const SessionModel = model<SessionDoc>(
  'MusicSession',
  new Schema<SessionDoc>(
    {
      guildId: { type: String, required: true, unique: true },
      voiceChannelId: { type: String, required: true },
      textChannelId: { type: String, default: null },
      volume: { type: Number, default: 80 },
      repeatMode: { type: String, default: 'off' },
      paused: { type: Boolean, default: false },
      position: { type: Number, default: 0 },
      filters: { type: [String], default: [] },
    },
    { timestamps: true },
  ),
);
