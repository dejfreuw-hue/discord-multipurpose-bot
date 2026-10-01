import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import type { Module } from '../core/module.js';
import { fromRoot } from '../core/paths.js';
import { ConfigError, describeIssues } from './errors.js';
import { configSchema, type Config } from './schema.js';

export interface LoadedConfig extends Config {
  /** Parsed `modules.<name>` sections, keyed by module name. Globally disabled modules are absent. */
  moduleSettings: Map<string, Record<string, unknown>>;
}

const FILE = 'config.yml';

export function loadConfig(modules: readonly Module[], file = fromRoot(FILE)): LoadedConfig {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new ConfigError(`Could not read ${file}. It should sit next to package.json. Re-download it from the release if it is gone.`);
  }

  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length > 0) {
    const details = doc.errors.map((e) => `  - ${e.message.split('\n')[0]}${e.linePos ? ` (line ${e.linePos[0].line})` : ''}`);
    throw new ConfigError(
      `${FILE} is not valid YAML:\n${details.join('\n')}\n\nCommon causes: tabs instead of spaces, a missing space after ":", or an unclosed quote.`,
    );
  }

  const parsed = configSchema.safeParse(doc.toJS() ?? {});
  if (!parsed.success) {
    throw new ConfigError(`${describeIssues(FILE, parsed.error.issues)}\n\nEach setting is explained by the comment above it in ${FILE}.`);
  }

  const config = parsed.data;
  const known = new Set(modules.map((m) => m.name));
  const unknown = Object.keys(config.modules).filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new ConfigError(
      `${FILE} has settings for unknown module(s): ${unknown.join(', ')}.\nValid module names: ${[...known].join(', ')}.`,
    );
  }

  const moduleSettings = new Map<string, Record<string, unknown>>();
  const problems: string[] = [];
  for (const mod of modules) {
    const schema = moduleConfigSchema(mod);
    const result = schema.safeParse(config.modules[mod.name] ?? {});
    if (!result.success) {
      problems.push(describeIssues(FILE, result.error.issues, ['modules', mod.name]));
      continue;
    }
    const section = result.data as Record<string, unknown>;
    if (section.enabled === false) continue;
    moduleSettings.set(mod.name, section);
  }
  if (problems.length > 0) {
    throw new ConfigError(`${problems.join('\n')}\n\nEach setting is explained by the comment above it in ${FILE}.`);
  }

  return { ...config, moduleSettings };
}

function moduleConfigSchema(mod: Module): z.ZodType {
  const base = mod.config ?? z.object({});
  // Core modules can't be switched off, so they don't accept an "enabled" key at all.
  const withToggle = mod.toggleable ? base.extend({ enabled: z.boolean().default(true) }) : base;
  return withToggle.strict();
}
