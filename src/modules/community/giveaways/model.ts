import { Schema, model } from 'mongoose';

export interface GiveawayDoc {
  guildId: string;
  giveawayId: number;
  channelId: string;
  messageId: string | null;
  hostId: string;
  prize: string;
  description: string | null;
  winnerCount: number;
  endsAt: Date;
  status: 'running' | 'ended' | 'cancelled';
  entrants: string[];
  winners: string[];
  requirements: { roleId: string | null; minAccountDays: number; minServerDays: number; minLevel: number };
  bonus: { boosterEntries: number; bonusRoles: { roleId: string; entries: number }[] };
}

const schema = new Schema<GiveawayDoc>(
  {
    guildId: { type: String, required: true },
    giveawayId: { type: Number, required: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: null },
    hostId: { type: String, required: true },
    prize: { type: String, required: true },
    description: { type: String, default: null },
    winnerCount: { type: Number, default: 1 },
    endsAt: { type: Date, required: true },
    status: { type: String, enum: ['running', 'ended', 'cancelled'], default: 'running' },
    entrants: { type: [String], default: [] },
    winners: { type: [String], default: [] },
    requirements: {
      roleId: { type: String, default: null },
      minAccountDays: { type: Number, default: 0 },
      minServerDays: { type: Number, default: 0 },
      minLevel: { type: Number, default: 0 },
    },
    bonus: {
      boosterEntries: { type: Number, default: 0 },
      bonusRoles: { type: [{ roleId: String, entries: Number, _id: false }], default: [] },
    },
  },
  { timestamps: true },
);
schema.index({ guildId: 1, giveawayId: 1 }, { unique: true });
schema.index({ status: 1, endsAt: 1 });

export const GiveawayModel = model<GiveawayDoc>('Giveaway', schema);
