import { randomBytes } from 'node:crypto';
import { Schema, model } from 'mongoose';
import type { GuildSnapshot } from './snapshot.js';

export interface BackupDoc {
  /** Short public ID, so backups can be restored onto another server by their creator. */
  backupId: string;
  guildId: string;
  guildName: string;
  name: string;
  createdBy: string;
  automatic: boolean;
  roleCount: number;
  channelCount: number;
  snapshot: GuildSnapshot;
  createdAt: Date;
}

const schema = new Schema<BackupDoc>(
  {
    backupId: { type: String, required: true, unique: true },
    guildId: { type: String, required: true, index: true },
    guildName: { type: String, required: true },
    name: { type: String, required: true },
    createdBy: { type: String, required: true },
    automatic: { type: Boolean, default: false },
    roleCount: { type: Number, required: true },
    channelCount: { type: Number, required: true },
    snapshot: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const BackupModel = model<BackupDoc>('Backup', schema);

export function newBackupId(): string {
  return randomBytes(5).toString('hex');
}
