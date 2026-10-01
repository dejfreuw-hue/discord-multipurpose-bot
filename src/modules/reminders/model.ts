import { Schema, model, type Types } from 'mongoose';

export interface ReminderDoc {
  _id: Types.ObjectId;
  /** Per-user number shown in /remind list. */
  number: number;
  userId: string;
  guildId: string | null;
  /** Where to post it. Null means by DM. */
  channelId: string | null;
  text: string;
  /** Language of whoever set it, so DMs come in their language. */
  locale: string;
  dueAt: Date;
  repeatMs: number | null;
  /** Delivered one-off reminders stay around briefly so their snooze buttons keep working. */
  done: boolean;
  expireAt: Date | null;
}

const schema = new Schema<ReminderDoc>(
  {
    number: { type: Number, required: true },
    userId: { type: String, required: true, index: true },
    guildId: { type: String, default: null },
    channelId: { type: String, default: null },
    text: { type: String, required: true },
    locale: { type: String, required: true },
    dueAt: { type: Date, required: true },
    repeatMs: { type: Number, default: null },
    done: { type: Boolean, default: false },
    expireAt: { type: Date, default: null },
  },
  { timestamps: true },
);
schema.index({ done: 1, dueAt: 1 });
schema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const ReminderModel = model<ReminderDoc>('Reminder', schema);

const SNOOZE_WINDOW_MS = 24 * 3_600_000;

/**
 * Claims a due reminder so it's delivered exactly once, even if two ticks overlap. Repeating
 * reminders move to their next time; one-off reminders are marked done.
 */
export async function claimReminder(doc: ReminderDoc, nextDueAt: Date | null, now: Date): Promise<boolean> {
  const update = nextDueAt ? { dueAt: nextDueAt } : { done: true, expireAt: new Date(now.getTime() + SNOOZE_WINDOW_MS) };
  const result = await ReminderModel.updateOne({ _id: doc._id, done: false, dueAt: doc.dueAt }, update);
  return result.modifiedCount === 1;
}
