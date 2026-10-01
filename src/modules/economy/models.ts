import { Schema, model } from 'mongoose';

export interface EconomyProfileDoc {
  guildId: string;
  userId: string;
  wallet: number;
  bank: number;
  lastDaily: Date | null;
  dailyStreak: number;
  lastWeekly: Date | null;
  lastWork: Date | null;
  lastRob: Date | null;
  inventory: { itemId: number; quantity: number }[];
}

const profileSchema = new Schema<EconomyProfileDoc>(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    wallet: { type: Number, default: 0 },
    bank: { type: Number, default: 0 },
    lastDaily: { type: Date, default: null },
    dailyStreak: { type: Number, default: 0 },
    lastWeekly: { type: Date, default: null },
    lastWork: { type: Date, default: null },
    lastRob: { type: Date, default: null },
    inventory: { type: [{ itemId: Number, quantity: Number, _id: false }], default: [] },
  },
  { timestamps: true },
);
profileSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const EconomyProfileModel = model<EconomyProfileDoc>('EconomyProfile', profileSchema);

export interface ShopItemDoc {
  guildId: string;
  itemId: number;
  name: string;
  description: string | null;
  price: number;
  /** Buying gives this role. Items without a role go to the buyer's inventory. */
  roleId: string | null;
  /** Null is unlimited. */
  stock: number | null;
}

const itemSchema = new Schema<ShopItemDoc>(
  {
    guildId: { type: String, required: true },
    itemId: { type: Number, required: true },
    name: { type: String, required: true },
    description: { type: String, default: null },
    price: { type: Number, required: true },
    roleId: { type: String, default: null },
    stock: { type: Number, default: null },
  },
  { timestamps: true },
);
itemSchema.index({ guildId: 1, itemId: 1 }, { unique: true });

export const ShopItemModel = model<ShopItemDoc>('ShopItem', itemSchema);
