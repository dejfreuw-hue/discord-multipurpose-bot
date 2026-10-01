import { Schema, model } from 'mongoose';

export interface MenuOption {
  roleId: string;
  label: string;
  emoji: string | null;
  description: string | null;
}

export interface RoleMenuDoc {
  guildId: string;
  menuId: number;
  title: string;
  description: string;
  mode: 'buttons' | 'select' | 'reactions';
  /** Picking a role removes the menu's other roles. */
  exclusive: boolean;
  channelId: string | null;
  messageId: string | null;
  options: MenuOption[];
}

const schema = new Schema<RoleMenuDoc>(
  {
    guildId: { type: String, required: true },
    menuId: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    mode: { type: String, enum: ['buttons', 'select', 'reactions'], default: 'buttons' },
    exclusive: { type: Boolean, default: false },
    channelId: { type: String, default: null },
    messageId: { type: String, default: null, index: true },
    options: {
      type: [{ roleId: String, label: String, emoji: { type: String, default: null }, description: { type: String, default: null }, _id: false }],
      default: [],
    },
  },
  { timestamps: true },
);
schema.index({ guildId: 1, menuId: 1 }, { unique: true });

export const RoleMenuModel = model<RoleMenuDoc>('RoleMenu', schema);
