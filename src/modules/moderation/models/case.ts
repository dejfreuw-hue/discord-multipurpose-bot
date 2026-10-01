import { Schema, model } from 'mongoose';

export const CASE_TYPES = ['ban', 'unban', 'kick', 'timeout', 'untimeout', 'warn'] as const;
export type CaseType = (typeof CASE_TYPES)[number];

/** Where a case came from: a slash command, AutoMod, the AI image scanner, an action outside the bot, or an expiry. */
export type CaseSource = 'command' | 'automod' | 'scanner' | 'external' | 'expiry';

export interface CaseDoc {
  guildId: string;
  caseId: number;
  type: CaseType;
  userId: string;
  userTag: string;
  moderatorId: string;
  moderatorTag: string;
  reason: string | null;
  duration: number | null;
  expiresAt: Date | null;
  /** For temporary bans: still waiting to be lifted. */
  active: boolean;
  source: CaseSource;
  logChannelId: string | null;
  logMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<CaseDoc>(
  {
    guildId: { type: String, required: true },
    caseId: { type: Number, required: true },
    type: { type: String, enum: CASE_TYPES, required: true },
    userId: { type: String, required: true },
    userTag: { type: String, required: true },
    moderatorId: { type: String, required: true },
    moderatorTag: { type: String, required: true },
    reason: { type: String, default: null },
    duration: { type: Number, default: null },
    expiresAt: { type: Date, default: null },
    active: { type: Boolean, default: false },
    source: { type: String, default: 'command' },
    logChannelId: { type: String, default: null },
    logMessageId: { type: String, default: null },
  },
  { timestamps: true },
);

schema.index({ guildId: 1, caseId: 1 }, { unique: true });
schema.index({ guildId: 1, userId: 1, createdAt: -1 });
schema.index({ active: 1, expiresAt: 1 }, { partialFilterExpression: { active: true } });

export const CaseModel = model<CaseDoc>('ModerationCase', schema);
