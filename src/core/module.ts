import type {
  AnySelectMenuInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  ClientEvents,
  GatewayIntentBits,
  ModalSubmitInteraction,
  Partials,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import type { z } from 'zod';
import type { Bot } from './bot.js';
import type { CommandContext, ComponentContext, GuildContext } from './context.js';
import type { PermissionRequirements } from './permissions.js';
import type { PanelRow } from './ui/panel.js';

/**
 * How the router acknowledges an interaction before running the handler.
 * `false` means the handler responds itself within 3 seconds (needed for showing a modal).
 */
export type DeferMode = 'public' | 'ephemeral' | 'update' | false;

/** Where a command can be used. `anywhere` also makes it user-installable (DMs and other servers). */
export type Scope = 'guild' | 'anywhere';

type SlashData = SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder | { toJSON(): unknown; name: string };

interface CommandBase {
  /**
   * Descriptions in the builder are locale keys (e.g. "core.ping.description"). They are
   * translated when commands are registered, so they show up in each user's language.
   */
  data: SlashData;
  defer?: Exclude<DeferMode, 'update'>;
  /** Seconds. Falls back to commands.cooldowns in config.yml, then commands.defaultCooldown. */
  cooldown?: number;
  permissions?: PermissionRequirements;
  autocomplete?(interaction: AutocompleteInteraction, bot: Bot): Promise<void>;
}

export interface GuildCommand extends CommandBase {
  scope?: 'guild';
  run(ctx: CommandContext<true>): Promise<void>;
}

export interface AnywhereCommand extends CommandBase {
  scope: 'anywhere';
  run(ctx: CommandContext<boolean>): Promise<void>;
}

export type Command = GuildCommand | AnywhereCommand;

export type ComponentKind = 'button' | 'select' | 'modal';

type InteractionFor<K extends ComponentKind> = K extends 'button'
  ? ButtonInteraction<'cached'>
  : K extends 'select'
    ? AnySelectMenuInteraction<'cached'>
    : ModalSubmitInteraction<'cached'>;

/**
 * Handles buttons, select menus or modals whose custom ID starts with `id`.
 * Custom IDs look like "module:action:arg1:arg2"; everything after `id` is passed as `args`.
 * Components are server-only. IDs starting with "~" are left alone by the router, for code
 * that waits on a component with a collector instead.
 */
export interface ComponentHandler<K extends ComponentKind = ComponentKind> {
  kind: K;
  id: string;
  defer?: DeferMode;
  permissions?: PermissionRequirements;
  run(ctx: ComponentContext<InteractionFor<K>>, args: string[]): Promise<void>;
}

export interface EventHandler<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  run(bot: Bot, ...args: ClientEvents[K]): Promise<void> | void;
}

export interface SetupStepView {
  text: string;
  rows: PanelRow[];
}

/** One page in the /setup wizard. Modules add their own pages here. */
export interface SetupStep {
  id: string;
  render(ctx: GuildContext): Promise<SetupStepView>;
}

export interface Module<C extends z.ZodObject = z.ZodObject, S extends z.ZodType = z.ZodType> {
  /** Used in config.yml, custom IDs and locale keys. Lowercase, no spaces. */
  name: string;
  /** Whether servers (and config.yml) can turn this module off. */
  toggleable: boolean;
  intents?: GatewayIntentBits[];
  partials?: Partials[];
  /** Schema for `modules.<name>` in config.yml. */
  config?: C;
  /** Schema for this module's per-server settings. Every field needs a default. */
  guildSettings?: S;
  commands?: Command[];
  components?: ComponentHandler[];
  events?: EventHandler[];
  setup?: SetupStep[];
  /** Runs once after the client is ready. */
  start?(bot: Bot): Promise<void> | void;
  /** Runs during shutdown, before the client disconnects. */
  stop?(bot: Bot): Promise<void> | void;
}

// Returns the exact type passed in, so `guildSettings` and `config` keep their concrete schemas
// for typed lookups like bot.settings.module(guildId, mod).
export function defineModule<M extends Module>(mod: M): M {
  return mod;
}

export function defineCommand(command: GuildCommand): GuildCommand;
export function defineCommand(command: AnywhereCommand): AnywhereCommand;
export function defineCommand(command: Command): Command {
  return command;
}

export function defineComponent<K extends ComponentKind>(handler: ComponentHandler<K>): ComponentHandler {
  return handler as unknown as ComponentHandler;
}

export function defineEvent<K extends keyof ClientEvents>(handler: EventHandler<K>): EventHandler {
  return handler as unknown as EventHandler;
}
