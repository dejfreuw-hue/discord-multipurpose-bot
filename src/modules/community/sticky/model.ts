import { Schema, model } from 'mongoose';

export interface StickyDoc {
  guildId: string;
  channelId: string;
  content: string;
  messageId: string | null;
}

const schema = new Schema<StickyDoc>(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, unique: true },
    content: { type: String, required: true },
    messageId: { type: String, default: null },
  },
  { timestamps: true },
);

export const StickyModel = model<StickyDoc>('StickyMessage', schema);
