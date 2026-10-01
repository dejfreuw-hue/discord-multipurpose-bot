import { PermissionFlagsBits, PermissionsBitField, type GuildMember, type PermissionResolvable, type Role } from 'discord.js';
import { UserError } from './errors.js';

export interface PermissionRequirements {
  /** Discord permissions the user needs in the channel. */
  user?: PermissionResolvable;
  /** Discord permissions the bot needs in the channel. */
  bot?: PermissionResolvable;
  /** Require Administrator or one of the server's configured staff roles. */
  staff?: boolean;
  /** Members with a staff role may use this even without the `user` permissions. */
  allowStaff?: boolean;
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

/**
 * Refuses roles the bot can't hand out, or that `actor` couldn't hand out themselves (null when
 * the bot acts on its own). The second check stops someone with Manage Roles from using the bot
 * to give out roles above their own.
 */
export async function assertAssignableRole(role: Role, actor: GuildMember | null): Promise<void> {
  const me = role.guild.members.me ?? (await role.guild.members.fetchMe());
  const vars = { role: role.toString() };
  if (role.id === role.guild.id) throw new UserError('errors.everyoneRole');
  if (role.managed) throw new UserError('errors.managedRole', vars);
  if (me.roles.highest.comparePositionTo(role) <= 0) throw new UserError('errors.botRoleHierarchy', vars);
  if (actor && actor.id !== role.guild.ownerId && actor.roles.highest.comparePositionTo(role) <= 0) {
    throw new UserError('errors.userRoleHierarchy', vars);
  }
}
