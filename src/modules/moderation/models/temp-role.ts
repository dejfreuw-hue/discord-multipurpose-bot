import { Schema, model } from 'mongoose';

export interface TempRoleDoc {
  guildId: string;
  userId: string;
  roleId: string;
  moderatorId: string;
  reason: string | null;
  expiresAt: Date;
}

const schema = new Schema<TempRoleDoc>(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    roleId: { type: String, required: true },
    moderatorId: { type: String, required: true },
    reason: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

schema.index({ guildId: 1, userId: 1, roleId: 1 }, { unique: true });
schema.index({ expiresAt: 1 });

export const TempRoleModel = model<TempRoleDoc>('TempRole', schema);
