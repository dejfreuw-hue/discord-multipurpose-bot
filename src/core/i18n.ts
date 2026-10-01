import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { LocalizationMap } from 'discord.js';

export type Vars = Record<string, string | number>;

interface LocaleMeta {
  name: string;
  /** Discord locale codes this file covers, e.g. ["en-US", "en-GB"]. */
  discord: string[];
}

interface Locale {
  code: string;
  meta: LocaleMeta;
  strings: Map<string, string>;
  plurals: Intl.PluralRules;
}

/**
 * Translations loaded from /locales/*.json. Keys are dotted paths into the JSON ("core.ping.title").
 * Placeholders use {name}. A key with "_one" / "_other" variants is pluralised on the `count` variable.
 */
export class I18n {
  private readonly locales = new Map<string, Locale>();
  private readonly reportedMissing = new Set<string>();

  constructor(
    readonly fallback: string,
    private readonly onMissing: (key: string, locale: string) => void = () => {},
  ) {}

  static fromDirectory(dir: string, fallback: string, onMissing?: (key: string, locale: string) => void): I18n {
    const i18n = new I18n(fallback, onMissing);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>;
      i18n.add(basename(file, '.json'), raw);
    }
    return i18n;
  }

  add(code: string, raw: Record<string, unknown>): void {
    const { _meta, ...rest } = raw as { _meta?: Partial<LocaleMeta> };
    const strings = new Map<string, string>();
    flatten(rest, '', strings);
    this.locales.set(code, {
      code,
      meta: { name: _meta?.name ?? code, discord: _meta?.discord ?? [] },
      strings,
      plurals: new Intl.PluralRules(code),
    });
  }

  has(code: string): boolean {
    return this.locales.has(code);
  }

  hasKey(key: string): boolean {
    return this.locales.get(this.fallback)?.strings.has(key) ?? false;
  }

  list(): { code: string; name: string }[] {
    return [...this.locales.values()].map((l) => ({ code: l.code, name: l.meta.name }));
  }

  t(code: string, key: string, vars?: Vars): string {
    const value = this.lookup(code, key, vars) ?? this.lookup(this.fallback, key, vars);
    if (value === undefined) {
      if (!this.reportedMissing.has(key)) {
        this.reportedMissing.add(key);
        this.onMissing(key, code);
      }
      return key;
    }
    return vars ? interpolate(value, vars) : value;
  }

  /** Maps a Discord locale ("de", "en-GB", "pt-BR") to one of the loaded locale files, or undefined. */
  fromDiscord(discordLocale: string | null | undefined): string | undefined {
    if (!discordLocale) return undefined;
    for (const locale of this.locales.values()) {
      if (locale.meta.discord.includes(discordLocale)) return locale.code;
    }
    if (this.locales.has(discordLocale)) return discordLocale;
    const base = discordLocale.split('-')[0]!;
    return this.locales.has(base) ? base : undefined;
  }

  /** Translations of `key` for every loaded locale except the fallback, in Discord's localization format. */
  localizations(key: string): LocalizationMap {
    const map: Record<string, string> = {};
    for (const locale of this.locales.values()) {
      if (locale.code === this.fallback) continue;
      const value = locale.strings.get(key);
      if (!value) continue;
      for (const discordCode of locale.meta.discord) map[discordCode] = value;
    }
    return map;
  }

  private lookup(code: string, key: string, vars?: Vars): string | undefined {
    const locale = this.locales.get(code);
    if (!locale) return undefined;
    if (vars && typeof vars.count === 'number') {
      const plural = locale.strings.get(`${key}_${locale.plurals.select(vars.count)}`) ?? locale.strings.get(`${key}_other`);
      if (plural !== undefined) return plural;
    }
    return locale.strings.get(key);
  }
}

function flatten(node: unknown, prefix: string, out: Map<string, string>): void {
  if (typeof node === 'string') {
    out.set(prefix, node);
    return;
  }
  if (Array.isArray(node)) {
    out.set(prefix, node.join('\n'));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) flatten(value, prefix ? `${prefix}.${key}` : key, out);
  }
}

function interpolate(text: string, vars: Vars): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
