import { PermissionFlagsBits, PermissionsBitField, type GuildMember, type PermissionResolvable } from 'discord.js';

export interface PermissionRequirements {
  /** Discord permissions the user needs in the channel. */
  user?: PermissionResolvable;
  /** Discord permissions the bot needs in the channel. */
  bot?: PermissionResolvable;
  /** Require Administrator or one of the server's configured staff roles. */
  staff?: boolean;
  /** Only bot owners from config.yml (or the application owner). */
  owner?: boolean;
}

export function missingPermissions(have: Readonly<PermissionsBitField> | null, need: PermissionResolvable | undefined): string[] {
  if (need === undefined) return [];
  const required = new PermissionsBitField(need);
  if (!have) return required.toArray();
  if (have.has(PermissionFlagsBits.Administrator)) return [];
  return have.missing(required);
}

export function isStaff(member: GuildMember, staffRoles: readonly string[]): boolean {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return staffRoles.some((id) => member.roles.cache.has(id));
}

/** "ManageGuild" -> "Manage Server", matching what people see in Discord's settings. */
export function permissionLabel(flag: string): string {
  return flag
    .replace(/Guild/g, 'Server')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/V A D/, 'VAD');
}

/**
 * Whether `actor` may act on `target` by Discord's own rules: owners are untouchable and
 * you can only affect members whose highest role is below yours.
 */
export function outranks(actor: GuildMember, target: GuildMember): boolean {
  if (target.id === target.guild.ownerId) return false;
  if (actor.id === actor.guild.ownerId) return true;
  return actor.roles.highest.comparePositionTo(target.roles.highest) > 0;
}
