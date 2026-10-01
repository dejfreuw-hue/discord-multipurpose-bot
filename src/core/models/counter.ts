import { Schema, model } from 'mongoose';

const schema = new Schema<{ _id: string; seq: number }>({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });

const CounterModel = model('Counter', schema);

/** Atomically increments and returns the counter for `key`, starting at 1. Safe across concurrent calls. */
export async function nextSequence(key: string): Promise<number> {
  const doc = await CounterModel.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', lean: true });
  return doc!.seq;
}
