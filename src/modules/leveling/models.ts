import { Schema, model } from 'mongoose';

export interface ProfileDoc {
  guildId: string;
  userId: string;
  xp: number;
  level: number;
  messages: number;
  voiceMinutes: number;
  card: { preset: string | null; color: number | null };
}

const profileSchema = new Schema<ProfileDoc>(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 0 },
    messages: { type: Number, default: 0 },
    voiceMinutes: { type: Number, default: 0 },
    card: {
      preset: { type: String, default: null },
      color: { type: Number, default: null },
    },
  },
  { timestamps: true },
);
profileSchema.index({ guildId: 1, userId: 1 }, { unique: true });
profileSchema.index({ guildId: 1, xp: -1 });
profileSchema.index({ guildId: 1, voiceMinutes: -1 });
profileSchema.index({ guildId: 1, messages: -1 });
profileSchema.index({ userId: 1 });

export const ProfileModel = model<ProfileDoc>('LevelProfile', profileSchema);

/**
 * Uploaded card backgrounds, already resized to card size. Stored instead of linked because
 * Discord attachment links expire. userId is empty for a server's default background.
 */
interface BackgroundDoc {
  guildId: string;
  userId: string;
  data: Buffer;
}

const backgroundSchema = new Schema<BackgroundDoc>({ guildId: String, userId: String, data: Buffer }, { timestamps: true });
backgroundSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const BackgroundModel = model<BackgroundDoc>('CardBackground', backgroundSchema);
