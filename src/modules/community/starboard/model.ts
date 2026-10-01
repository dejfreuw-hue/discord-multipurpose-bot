import { Schema, model } from 'mongoose';

export interface StarEntryDoc {
  guildId: string;
  messageId: string;
  channelId: string;
  starboardMessageId: string;
  count: number;
}

const schema = new Schema<StarEntryDoc>({
  guildId: { type: String, required: true },
  messageId: { type: String, required: true },
  channelId: { type: String, required: true },
  starboardMessageId: { type: String, required: true },
  count: { type: Number, default: 0 },
});
schema.index({ guildId: 1, messageId: 1 }, { unique: true });

export const StarEntryModel = model<StarEntryDoc>('StarEntry', schema);
