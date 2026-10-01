import type { z } from 'zod';
import type { Logger } from './logger.js';
import { GuildSettingsModel, type GuildSettingsDoc } from './models/guild-settings.js';

export type GuildSettingsData = Readonly<GuildSettingsDoc>;
type CorePatch = Partial<Pick<GuildSettingsDoc, 'locale' | 'color' | 'staffRoles' | 'disabledModules'>>;

/** The part of a module the settings store needs. Modules usually export this from their settings file. */
export interface SettingsSlice<S extends z.ZodType> {
  name: string;
  guildSettings: S;
}

/**
 * Per-guild settings, cached in memory. Writes go to Mongo first and only update the cache
 * once they succeed, so the cache never holds something the database doesn't.
 */
export class GuildSettings {
  private readonly cache = new Map<string, GuildSettingsData>();
  private readonly pending = new Map<string, Promise<GuildSettingsData>>();

  constructor(private readonly logger: Logger) {}

  async get(guildId: string): Promise<GuildSettingsData> {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    // Several interactions for a fresh guild can arrive at once; share one load between them.
    let loading = this.pending.get(guildId);
    if (!loading) {
      loading = this.load(guildId).finally(() => this.pending.delete(guildId));
      this.pending.set(guildId, loading);
    }
    return loading;
  }

  /** The cached settings, without touching the database. */
  peek(guildId: string): GuildSettingsData | undefined {
    return this.cache.get(guildId);
  }

  async update(guildId: string, patch: CorePatch): Promise<GuildSettingsData> {
    return this.write(guildId, { $set: patch });
  }

  /** Parsed settings for one module, with defaults filled in for anything not stored yet. */
  async module<S extends z.ZodType>(guildId: string, mod: SettingsSlice<S>): Promise<z.output<S>> {
    const data = await this.get(guildId);
    return this.parseModule(mod, data.modules[mod.name]);
  }

  async updateModule<S extends z.ZodType>(
    guildId: string,
    mod: SettingsSlice<S>,
    patch: Partial<z.input<S>>,
  ): Promise<z.output<S>> {
    const current = await this.module(guildId, mod);
    const next = mod.guildSettings.parse({ ...(current as object), ...patch });
    await this.write(guildId, { $set: { [`modules.${mod.name}`]: next } });
    return next;
  }

  async setModuleEnabled(guildId: string, moduleName: string, enabled: boolean): Promise<GuildSettingsData> {
    return this.write(guildId, enabled ? { $pull: { disabledModules: moduleName } } : { $addToSet: { disabledModules: moduleName } });
  }

  evict(guildId: string): void {
    this.cache.delete(guildId);
  }

  get size(): number {
    return this.cache.size;
  }

  private parseModule<S extends z.ZodType>(mod: SettingsSlice<S>, raw: unknown): z.output<S> {
    const parsed = mod.guildSettings.safeParse(raw ?? {});
    if (parsed.success) return parsed.data;
    // Stored data can go stale after an update changes a schema. Falling back to defaults
    // beats breaking every command in that guild.
    this.logger.warn({ module: mod.name, issues: parsed.error.issues }, 'stored guild settings invalid, using defaults');
    return mod.guildSettings.parse({});
  }

  private async load(guildId: string): Promise<GuildSettingsData> {
    const doc = await GuildSettingsModel.findOneAndUpdate(
      { guildId },
      { $setOnInsert: { guildId } },
      { upsert: true, returnDocument: 'after', lean: true },
    );
    const data = toData(doc);
    this.cache.set(guildId, data);
    return data;
  }

  private async write(guildId: string, update: Record<string, unknown>): Promise<GuildSettingsData> {
    const doc = await GuildSettingsModel.findOneAndUpdate({ guildId }, update, { upsert: true, returnDocument: 'after', lean: true });
    const data = toData(doc);
    this.cache.set(guildId, data);
    return data;
  }
}

function toData(doc: GuildSettingsDoc | null): GuildSettingsData {
  if (!doc) throw new Error('upsert returned no document');
  return {
    guildId: doc.guildId,
    locale: doc.locale ?? null,
    color: doc.color ?? null,
    staffRoles: doc.staffRoles ?? [],
    disabledModules: doc.disabledModules ?? [],
    modules: doc.modules ?? {},
  };
}
