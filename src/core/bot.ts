import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  Team,
  type ActivitiesOptions,
  type ClientEvents,
  type PresenceData,
} from 'discord.js';
import type { z } from 'zod';
import type { Env } from '../config/env.js';
import type { LoadedConfig } from '../config/load.js';
import { buildCommands, syncCommands } from './command-sync.js';
import { Cooldowns } from './cooldowns.js';
import type { GuildSettings, GuildSettingsData } from './guild-settings.js';
import type { I18n } from './i18n.js';
import type { Logger } from './logger.js';
import type { Command, ComponentHandler, Module } from './module.js';
import { routeInteraction } from './router.js';
import { Panel } from './ui/panel.js';

export interface Registered<T> {
  item: T;
  module: Module;
}

export interface BotOptions {
  config: LoadedConfig;
  env: Env;
  logger: Logger;
  i18n: I18n;
  settings: GuildSettings;
  modules: readonly Module[];
  version: string;
}

export class Bot {
  readonly client: Client;
  readonly config: LoadedConfig;
  readonly env: Env;
  readonly logger: Logger;
  readonly i18n: I18n;
  readonly settings: GuildSettings;
  readonly version: string;
  /** Modules enabled in config.yml, in load order. */
  readonly modules: Module[];
  readonly commands = new Map<string, Registered<Command>>();
  readonly components = new Map<string, Registered<ComponentHandler>>();
  readonly cooldowns = new Cooldowns();
  /** Command name -> application command ID, for clickable command mentions. */
  readonly commandIds = new Map<string, string>();
  readonly startedAt = Date.now();
  stopping = false;
  private readonly owners: Set<string>;

  constructor(options: BotOptions) {
    this.config = options.config;
    this.env = options.env;
    this.logger = options.logger;
    this.i18n = options.i18n;
    this.settings = options.settings;
    this.version = options.version;
    this.modules = options.modules.filter((m) => this.config.moduleSettings.has(m.name));
    this.owners = new Set(this.config.bot.owners);

    const intents = new Set<GatewayIntentBits>([GatewayIntentBits.Guilds]);
    const partials = new Set(this.modules.flatMap((m) => m.partials ?? []));
    for (const mod of this.modules) for (const intent of mod.intents ?? []) intents.add(intent);

    this.client = new Client({
      intents: [...intents],
      partials: [...partials],
      presence: this.presence(),
      allowedMentions: { parse: ['users'], repliedUser: false },
    });

    this.register();
  }

  async start(): Promise<void> {
    this.client.once(Events.ClientReady, (client) => {
      this.onReady().catch((err) => this.logger.error({ err }, 'startup after ready failed'));
      this.logger.info(`ready as ${client.user.tag} in ${client.guilds.cache.size} guilds`);
    });
    this.client.on(Events.InteractionCreate, (interaction) => {
      routeInteraction(this, interaction).catch((err) => this.logger.error({ err }, 'router crashed'));
    });
    this.client.on(Events.GuildDelete, (guild) => this.settings.evict(guild.id));
    this.client.on(Events.Error, (err) => this.logger.error({ err }, 'client error'));
    this.client.on(Events.Warn, (msg) => this.logger.warn(msg));
    this.client.on(Events.ShardDisconnect, (_, shard) => this.logger.warn({ shard }, 'gateway disconnected'));
    this.client.on(Events.ShardResume, (shard) => this.logger.info({ shard }, 'gateway resumed'));

    await this.client.login(this.env.DISCORD_TOKEN);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const mod of [...this.modules].reverse()) {
      try {
        await mod.stop?.(this);
      } catch (err) {
        this.logger.error({ err, module: mod.name }, 'module stop failed');
      }
    }
    this.cooldowns.dispose();
    await this.client.destroy();
  }

  isOwner(userId: string): boolean {
    return this.owners.has(userId);
  }

  /** Whether a module is loaded and, for a guild, not switched off there. */
  isEnabled(moduleName: string, settings?: GuildSettingsData | null): boolean {
    const mod = this.modules.find((m) => m.name === moduleName);
    if (!mod) return false;
    return !(mod.toggleable && settings?.disabledModules.includes(moduleName));
  }

  /** The module's validated `modules.<name>` section from config.yml. */
  moduleConfig<C extends z.ZodObject>(mod: { name: string; config?: C }): z.output<C> {
    return (this.config.moduleSettings.get(mod.name) ?? {}) as z.output<C>;
  }

  panel(color = this.config.bot.color): Panel {
    return new Panel(color, this.config.ui.componentsV2);
  }

  commandMention(name: string): string {
    const id = this.commandIds.get(name.split(' ')[0]!);
    return id ? `</${name}:${id}>` : `\`/${name}\``;
  }

  private register(): void {
    for (const mod of this.modules) {
      for (const command of mod.commands ?? []) {
        const name = command.data.name;
        if (this.commands.has(name)) throw new Error(`command /${name} is defined twice (${mod.name})`);
        this.commands.set(name, { item: command, module: mod });
      }
      for (const handler of mod.components ?? []) {
        const key = `${handler.kind}:${handler.id}`;
        if (this.components.has(key)) throw new Error(`component ${key} is defined twice (${mod.name})`);
        this.components.set(key, { item: handler, module: mod });
      }
      for (const event of mod.events ?? []) {
        const listener = async (...args: ClientEvents[typeof event.name]) => {
          if (this.stopping) return;
          try {
            await event.run(this, ...args);
          } catch (err) {
            this.logger.error({ err, module: mod.name, event: event.name }, 'event handler failed');
          }
        };
        if (event.once) this.client.once(event.name, listener);
        else this.client.on(event.name, listener);
      }
    }
    this.logger.debug({ modules: this.modules.map((m) => m.name), commands: this.commands.size }, 'modules registered');
  }

  private async onReady(): Promise<void> {
    const app = await this.client.application!.fetch();
    if (this.owners.size === 0) {
      // Nobody listed in config.yml: fall back to whoever owns the application.
      if (app.owner instanceof Team) for (const id of app.owner.members.keys()) this.owners.add(id);
      else if (app.owner) this.owners.add(app.owner.id);
    }

    if (this.config.commands.autoRegister) {
      // A failed registration leaves the previous commands in place, which still work,
      // so log it and carry on rather than taking the bot down.
      try {
        const result = await syncCommands(buildCommands(this.modules, this.i18n), {
          token: this.env.DISCORD_TOKEN,
          applicationId: app.id,
          devGuildId: this.config.commands.devGuildId,
        });
        if (result === 'updated') this.logger.info({ count: this.commands.size }, 'slash commands registered');
      } catch (err) {
        this.logger.error({ err }, 'command registration failed, run "npm run commands:deploy" to retry');
      }
    }
    await this.loadCommandIds().catch((err) => this.logger.warn({ err }, 'could not fetch command ids'));

    for (const mod of this.modules) {
      try {
        await mod.start?.(this);
      } catch (err) {
        this.logger.error({ err, module: mod.name }, 'module start failed');
      }
    }
  }

  private async loadCommandIds(): Promise<void> {
    const devGuild = this.config.commands.devGuildId;
    const registered = devGuild
      ? await this.client.application!.commands.fetch({ guildId: devGuild })
      : await this.client.application!.commands.fetch();
    for (const command of registered.values()) this.commandIds.set(command.name, command.id);
  }

  private presence(): PresenceData {
    const { status, activity, text } = this.config.bot.presence;
    const types = {
      playing: ActivityType.Playing,
      listening: ActivityType.Listening,
      watching: ActivityType.Watching,
      competing: ActivityType.Competing,
      custom: ActivityType.Custom,
    } as const;
    const activities: ActivitiesOptions[] =
      activity === 'none' ? [] : activity === 'custom' ? [{ type: ActivityType.Custom, name: 'custom', state: text }] : [{ type: types[activity], name: text }];
    return { status, activities };
  }
}
