import { randomBytes } from 'node:crypto';
import {
  DiscordAPIError,
  MessageFlags,
  RESTJSONErrorCodes,
  time,
  TimestampStyles,
  type AnySelectMenuInteraction,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type PermissionResolvable,
  type PermissionsBitField,
} from 'discord.js';
import type { Bot, Registered } from './bot.js';
import { ComponentInteractionContext, InteractionContext } from './context.js';
import { UserError } from './errors.js';
import type { Command, ComponentHandler, ComponentKind, DeferMode } from './module.js';
import { isStaff, missingPermissions, permissionLabel, type PermissionRequirements } from './permissions.js';

type ComponentInteraction = ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction;

export async function routeInteraction(bot: Bot, interaction: Interaction): Promise<void> {
  if (bot.stopping) return;
  if (interaction.isChatInputCommand()) return runCommand(bot, interaction);
  if (interaction.isAutocomplete()) return runAutocomplete(bot, interaction);
  if (interaction.isButton()) return runComponent(bot, interaction, 'button');
  if (interaction.isAnySelectMenu()) return runComponent(bot, interaction, 'select');
  if (interaction.isModalSubmit()) return runComponent(bot, interaction, 'modal');
}

async function runCommand(bot: Bot, interaction: ChatInputCommandInteraction): Promise<void> {
  const ctx = new InteractionContext(bot, interaction, peekSettings(bot, interaction));
  const entry = bot.commands.get(interaction.commandName);
  if (!entry) {
    // Happens when a command was removed but Discord still has the old registration cached.
    await ctx.fail(ctx.errorPanel(ctx.t('errors.unknownCommand'))).catch(() => undefined);
    return;
  }

  const { item: command, module } = entry;
  try {
    if (command.scope !== 'anywhere' && !interaction.inCachedGuild()) throw new UserError('errors.guildOnly');
    checkPermissions(bot, ctx, command.permissions);

    const cooldownKey = `${interaction.commandName}:${interaction.user.id}`;
    const left = bot.isOwner(interaction.user.id) ? 0 : bot.cooldowns.remaining(cooldownKey);
    if (left > 0) {
      throw new UserError('errors.cooldown', { time: time(new Date(Date.now() + left), TimestampStyles.RelativeTime) });
    }

    await defer(ctx, command.defer ?? 'public');
    await loadGuildState(bot, ctx, module.name, module.toggleable, command.permissions);

    bot.cooldowns.start(cooldownKey, cooldownFor(bot, interaction.commandName, command));
    await (command.run as (c: InteractionContext<ChatInputCommandInteraction>) => Promise<void>)(ctx);
  } catch (err) {
    await reportFailure(bot, ctx, err, { command: interaction.commandName });
  }
}

async function runComponent(bot: Bot, interaction: ComponentInteraction, kind: ComponentKind): Promise<void> {
  if (interaction.customId.startsWith('~')) return;
  const ctx = new ComponentInteractionContext(bot, interaction, peekSettings(bot, interaction));
  const match = findComponent(bot, kind, interaction.customId);
  if (!match) {
    await ctx.fail(ctx.errorPanel(ctx.t('errors.expired'))).catch(() => undefined);
    return;
  }

  const { entry, args } = match;
  const { item: handler, module } = entry;
  try {
    if (!interaction.inCachedGuild()) throw new UserError('errors.guildOnly');
    checkPermissions(bot, ctx, handler.permissions);
    await defer(ctx, handler.defer ?? 'update');
    await loadGuildState(bot, ctx, module.name, module.toggleable, handler.permissions);
    await (handler.run as (c: ComponentInteractionContext<ComponentInteraction>, a: string[]) => Promise<void>)(ctx, args);
  } catch (err) {
    await reportFailure(bot, ctx, err, { component: handler.id });
  }
}

async function runAutocomplete(bot: Bot, interaction: AutocompleteInteraction): Promise<void> {
  const command = bot.commands.get(interaction.commandName)?.item;
  if (!command?.autocomplete) return;
  try {
    await command.autocomplete(interaction, bot);
  } catch (err) {
    bot.logger.warn({ err, command: interaction.commandName }, 'autocomplete failed');
    if (!interaction.responded) await interaction.respond([]).catch(() => undefined);
  }
}

function findComponent(
  bot: Bot,
  kind: ComponentKind,
  customId: string,
): { entry: Registered<ComponentHandler>; args: string[] } | undefined {
  const parts = customId.split(':');
  for (let n = parts.length; n > 0; n--) {
    const entry = bot.components.get(`${kind}:${parts.slice(0, n).join(':')}`);
    if (entry) return { entry, args: parts.slice(n) };
  }
  return undefined;
}

function peekSettings(bot: Bot, interaction: Interaction) {
  return interaction.inCachedGuild() ? (bot.settings.peek(interaction.guildId) ?? null) : null;
}

async function defer(ctx: InteractionContext, mode: DeferMode): Promise<void> {
  const i = ctx.interaction;
  if (mode === false || i.deferred || i.replied) return;
  if (mode === 'update' && (i.isMessageComponent() || (i.isModalSubmit() && i.isFromMessage()))) {
    await i.deferUpdate();
  } else {
    await i.deferReply(mode === 'ephemeral' || mode === 'update' ? { flags: MessageFlags.Ephemeral } : {});
    mode = mode === 'update' ? 'ephemeral' : mode;
  }
  ctx.deferMode = mode;
}

function checkPermissions(bot: Bot, ctx: InteractionContext, req: PermissionRequirements | undefined): void {
  if (!req) return;
  const i = ctx.interaction;
  if (req.owner && !bot.isOwner(i.user.id)) throw new UserError('errors.ownerOnly');
  if (bot.isOwner(i.user.id)) return;

  // With allowStaff the user check needs the guild's staff roles, so it waits for loadGuildState.
  if (!req.allowStaff) assertUserPermissions(i.memberPermissions, req.user);
  const botMissing = missingPermissions(i.appPermissions, req.bot);
  if (botMissing.length > 0) {
    throw new UserError('errors.botPermissions', { permissions: botMissing.map(permissionLabel).join(', ') });
  }
}

async function loadGuildState(
  bot: Bot,
  ctx: InteractionContext,
  moduleName: string,
  toggleable: boolean,
  req: PermissionRequirements | undefined,
): Promise<void> {
  const i = ctx.interaction;
  if (!i.inCachedGuild()) return;
  ctx.settings = await bot.settings.get(i.guildId);
  if (toggleable && ctx.settings.disabledModules.includes(moduleName)) {
    throw new UserError('errors.moduleDisabled', { module: ctx.t(`modules.${moduleName}.name`) });
  }
  if (!req || bot.isOwner(i.user.id)) return;
  if (req.staff && !isStaff(i.member, ctx.settings.staffRoles)) throw new UserError('errors.staffOnly');
  if (req.allowStaff && !isStaff(i.member, ctx.settings.staffRoles)) assertUserPermissions(i.memberPermissions, req.user);
}

function assertUserPermissions(have: Readonly<PermissionsBitField> | null, need: PermissionResolvable | undefined): void {
  const missing = missingPermissions(have, need);
  if (missing.length > 0) {
    throw new UserError('errors.userPermissions', { permissions: missing.map(permissionLabel).join(', ') });
  }
}

function cooldownFor(bot: Bot, name: string, command: Command): number {
  return bot.config.commands.cooldowns[name] ?? command.cooldown ?? bot.config.commands.defaultCooldown;
}

async function reportFailure(bot: Bot, ctx: InteractionContext, err: unknown, where: Record<string, string>): Promise<void> {
  const i = ctx.interaction;
  let text: string;
  if (err instanceof UserError) {
    text = ctx.t(err.key, err.vars);
  } else if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownInteraction) {
    // The 3 second window passed before we could respond; there is nobody left to tell.
    bot.logger.warn({ ...where, user: i.user.id }, 'interaction expired before response');
    return;
  } else if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.MissingPermissions) {
    bot.logger.warn({ ...where, guild: i.guildId, msg: err.message }, 'missing discord permissions');
    text = ctx.t('errors.discordPermissions');
  } else {
    const ref = randomBytes(3).toString('hex');
    bot.logger.error({ err, ref, ...where, user: i.user.id, guild: i.guildId }, 'interaction failed');
    text = ctx.t('errors.generic', { ref });
  }

  try {
    await ctx.fail(ctx.errorPanel(text));
  } catch (sendErr) {
    bot.logger.warn({ err: sendErr, ...where }, 'could not send error message');
  }
}
