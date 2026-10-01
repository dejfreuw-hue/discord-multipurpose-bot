import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ApplicationIntegrationType,
  InteractionContextType,
  REST,
  Routes,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { I18n } from './i18n.js';
import type { Module } from './module.js';
import { fromRoot } from './paths.js';

const HASH_FILE = fromRoot('data', 'commands.sha256');

type CommandJSON = RESTPostAPIChatInputApplicationCommandsJSONBody;

/**
 * Builds the registration payload: translates description keys and applies each command's scope.
 * A module whose config.yml section has `hideCommands: false` gets its default member
 * permissions stripped, so its commands show up for everyone and the bot's own checks decide.
 */
export function buildCommands(
  modules: readonly Module[],
  i18n: I18n,
  moduleSettings?: ReadonlyMap<string, Record<string, unknown>>,
): CommandJSON[] {
  const out: CommandJSON[] = [];
  for (const mod of modules) {
    const showToAll = moduleSettings?.get(mod.name)?.hideCommands === false;
    for (const command of mod.commands ?? []) {
      const json = localize(structuredClone(command.data.toJSON()), i18n) as CommandJSON;
      if (showToAll) json.default_member_permissions = null;
      const anywhere = command.scope === 'anywhere';
      json.integration_types = anywhere
        ? [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall]
        : [ApplicationIntegrationType.GuildInstall];
      json.contexts = anywhere
        ? [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]
        : [InteractionContextType.Guild];
      out.push(json);
    }
  }
  return out;
}

function localize(node: unknown, i18n: I18n): unknown {
  if (Array.isArray(node)) return node.map((n) => localize(n, i18n));
  if (!node || typeof node !== 'object') return node;
  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object') obj[key] = localize(value, i18n);
  }
  if (typeof obj.description === 'string' && i18n.hasKey(obj.description)) {
    const key = obj.description;
    obj.description = i18n.t(i18n.fallback, key);
    obj.description_localizations = i18n.localizations(key);
  }
  // Option choices have no description, so their display name is the key instead.
  if (typeof obj.name === 'string' && 'value' in obj && i18n.hasKey(obj.name)) {
    const key = obj.name;
    obj.name = i18n.t(i18n.fallback, key);
    obj.name_localizations = i18n.localizations(key);
  }
  return obj;
}

export interface SyncOptions {
  token: string;
  applicationId: string;
  devGuildId: string;
  force?: boolean;
}

/**
 * Registers commands with Discord, skipping the request when nothing changed since the last
 * run. Global registration is rate limited, so blindly re-registering on every boot is a bad idea.
 */
export async function syncCommands(commands: CommandJSON[], options: SyncOptions): Promise<'updated' | 'unchanged'> {
  const target = options.devGuildId ? `guild:${options.devGuildId}` : 'global';
  const hash = createHash('sha256').update(target).update(JSON.stringify(commands)).digest('hex');
  if (!options.force && readHash() === hash) return 'unchanged';

  const rest = new REST().setToken(options.token);
  const route = options.devGuildId
    ? Routes.applicationGuildCommands(options.applicationId, options.devGuildId)
    : Routes.applicationCommands(options.applicationId);
  await rest.put(route, { body: commands });
  writeHash(hash);
  return 'updated';
}

export async function clearCommands(options: Omit<SyncOptions, 'force'>): Promise<void> {
  const rest = new REST().setToken(options.token);
  await rest.put(Routes.applicationCommands(options.applicationId), { body: [] });
  if (options.devGuildId) await rest.put(Routes.applicationGuildCommands(options.applicationId, options.devGuildId), { body: [] });
  writeHash('');
}

function readHash(): string {
  try {
    return readFileSync(HASH_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

function writeHash(hash: string): void {
  mkdirSync(dirname(HASH_FILE), { recursive: true });
  writeFileSync(HASH_FILE, hash);
}
