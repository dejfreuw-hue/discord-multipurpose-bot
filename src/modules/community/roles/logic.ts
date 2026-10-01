import type { GuildMember } from 'discord.js';

/** What the member's roles should become after toggling `roleId` in a menu. */
export function toggleRoles(held: ReadonlySet<string>, menuRoles: readonly string[], roleId: string, exclusive: boolean): { add: string[]; remove: string[] } {
  if (held.has(roleId)) return { add: [], remove: [roleId] };
  const remove = exclusive ? menuRoles.filter((id) => id !== roleId && held.has(id)) : [];
  return { add: [roleId], remove };
}

/** Changes for a select menu: picked roles are added, the menu's other roles are removed. */
export function selectRoles(held: ReadonlySet<string>, menuRoles: readonly string[], picked: readonly string[]): { add: string[]; remove: string[] } {
  const wanted = new Set(picked.filter((id) => menuRoles.includes(id)));
  return {
    add: [...wanted].filter((id) => !held.has(id)),
    remove: menuRoles.filter((id) => !wanted.has(id) && held.has(id)),
  };
}

/** Applies role changes, skipping roles the bot can no longer manage instead of failing them all. */
export async function applyRoles(member: GuildMember, changes: { add: string[]; remove: string[] }, reason: string): Promise<{ add: string[]; remove: string[] }> {
  const me = member.guild.members.me;
  const ok = (id: string) => {
    const role = member.guild.roles.cache.get(id);
    return Boolean(role && me && !role.managed && me.roles.highest.comparePositionTo(role) > 0);
  };
  const add = changes.add.filter(ok);
  const remove = changes.remove.filter(ok);
  if (add.length > 0) await member.roles.add(add, reason);
  if (remove.length > 0) await member.roles.remove(remove, reason);
  return { add, remove };
}
