import { Schema, model } from 'mongoose';

export interface TempChannelDoc {
  guildId: string;
  channelId: string;
  ownerId: string;
  hubId: string;
  locked: boolean;
  hidden: boolean;
  /**
   * Roles whose explicit allow we turned off while locking or hiding, so unlocking can give it
   * back. Needed on servers where a role (like "Verified") is what grants access, not @everyone.
   */
  lockedRoles: string[];
  hiddenRoles: string[];
  panelMessageId: string | null;
  renames: number[];
}

const schema = new Schema<TempChannelDoc>(
  {
    guildId: { type: String, required: true },
    channelId: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true },
    hubId: { type: String, required: true },
    locked: { type: Boolean, default: false },
    hidden: { type: Boolean, default: false },
    lockedRoles: { type: [String], default: [] },
    hiddenRoles: { type: [String], default: [] },
    panelMessageId: { type: String, default: null },
    renames: { type: [Number], default: [] },
  },
  { timestamps: true },
);
schema.index({ guildId: 1, ownerId: 1 });

export const TempChannelModel = model<TempChannelDoc>('TempVoiceChannel', schema);
