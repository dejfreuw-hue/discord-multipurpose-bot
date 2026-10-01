import { PermissionFlagsBits, type Guild, type GuildMember, type Role } from 'discord.js';
import { UserError } from '../../core/errors.js';
import { outranks } from '../../core/permissions.js';

export type ModAction = 'ban' | 'kick' | 'timeout' | 'warn';

export async function botMember(guild: Guild): Promise<GuildMember> {
  return guild.members.me ?? guild.members.fetchMe();
}

/**
 * Checks Discord's hierarchy rules before touching a member, so the user gets a clear reason
 * instead of a generic "Missing Permissions". `moderator` is null when the bot acts on its own.
 */
export async function assertCanModerate(target: GuildMember, moderator: GuildMember | null, action: ModAction): Promise<void> {
  const me = await botMember(target.guild);
  const vars = { user: target.toString() };
  if (moderator && target.id === moderator.id) throw new UserError('moderation.errors.self');
  if (target.id === me.id) throw new UserError('moderation.errors.bot');
  if (target.id === target.guild.ownerId) throw new UserError('moderation.errors.owner');
  if (moderator && !outranks(moderator, target)) throw new UserError('moderation.errors.userHierarchy', vars);
  if (action === 'warn') return;
  if (!outranks(me, target)) throw new UserError('moderation.errors.botHierarchy', vars);
  // Discord silently refuses to time out administrators.
  if (action === 'timeout' && target.permissions.has(PermissionFlagsBits.Administrator)) {
    throw new UserError('moderation.errors.timeoutAdmin', vars);
  }
}

export async function assertCanAssign(role: Role, moderator: GuildMember | null): Promise<void> {
  const me = await botMember(role.guild);
  const vars = { role: role.toString() };
  if (role.id === role.guild.id) throw new UserError('moderation.errors.everyoneRole');
  if (role.managed) throw new UserError('moderation.errors.managedRole', vars);
  if (me.roles.highest.comparePositionTo(role) <= 0) throw new UserError('moderation.errors.botRoleHierarchy', vars);
  if (moderator && moderator.id !== role.guild.ownerId && moderator.roles.highest.comparePositionTo(role) <= 0) {
    throw new UserError('moderation.errors.userRoleHierarchy', vars);
  }
}
