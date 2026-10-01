import { Schema, model } from 'mongoose';

export interface GuildSettingsDoc {
  guildId: string;
  locale: string | null;
  color: number | null;
  staffRoles: string[];
  disabledModules: string[];
  /** Per-module settings keyed by module name. Each module validates its own slice with zod. */
  modules: Record<string, unknown>;
}

const schema = new Schema<GuildSettingsDoc>(
  {
    guildId: { type: String, required: true, unique: true },
    locale: { type: String, default: null },
    color: { type: Number, default: null },
    staffRoles: { type: [String], default: [] },
    disabledModules: { type: [String], default: [] },
    modules: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false },
);

export const GuildSettingsModel = model<GuildSettingsDoc>('GuildSettings', schema);
