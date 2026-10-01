import { Schema, model } from 'mongoose';

export interface BirthdayDoc {
  guildId: string;
  userId: string;
  month: number;
  day: number;
  year: number | null;
  /** Overrides the server's timezone for this member. */
  timeZone: string | null;
  /** Local year of the last celebration, so a birthday is announced once per year. */
  celebratedYear: number;
  roleUntil: Date | null;
}

const schema = new Schema<BirthdayDoc>({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  month: { type: Number, required: true },
  day: { type: Number, required: true },
  year: { type: Number, default: null },
  timeZone: { type: String, default: null },
  celebratedYear: { type: Number, default: 0 },
  roleUntil: { type: Date, default: null },
});
schema.index({ guildId: 1, userId: 1 }, { unique: true });
schema.index({ month: 1, day: 1 });
schema.index({ roleUntil: 1 });

export const BirthdayModel = model<BirthdayDoc>('Birthday', schema);
