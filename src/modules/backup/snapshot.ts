import { ChannelType, OverwriteType, type Guild } from 'discord.js';

export interface RoleSnapshot {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  /** Permission bitfield as a decimal string; it doesn't fit in a JSON number. */
  permissions: string;
  position: number;
  everyone: boolean;
  /** Bot and integration roles: never created or deleted, only matched by name for overwrites. */
  managed: boolean;
}

export interface OverwriteSnapshot {
  id: string;
  type: OverwriteType;
  allow: string;
  deny: string;
}

export interface ChannelSnapshot {
  id: string;
  name: string;
  type: ChannelType;
  parentId: string | null;
  position: number;
  topic: string | null;
  nsfw: boolean;
  rateLimitPerUser: number;
  bitrate: number | null;
  userLimit: number | null;
  overwrites: OverwriteSnapshot[];
}

export interface GuildSnapshot {
  name: string;
  verificationLevel: number;
  explicitContentFilter: number;
  defaultMessageNotifications: number;
  afkTimeout: number;
  afkChannelId: string | null;
  systemChannelId: string | null;
  roles: RoleSnapshot[];
  channels: ChannelSnapshot[];
}

/** Channel types a backup can recreate. Threads and directory channels are left out. */
export const SUPPORTED_TYPES: readonly ChannelType[] = [
  ChannelType.GuildCategory,
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
];

export function takeSnapshot(guild: Guild): GuildSnapshot {
  const roles = guild.roles.cache.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.colors.primaryColor,
    hoist: r.hoist,
    mentionable: r.mentionable,
    permissions: r.permissions.bitfield.toString(),
    position: r.position,
    everyone: r.id === guild.id,
    managed: r.managed,
  }));
  const channels: ChannelSnapshot[] = [];
  for (const c of guild.channels.cache.values()) {
    if (c.isThread() || !SUPPORTED_TYPES.includes(c.type)) continue;
    channels.push({
      id: c.id,
      name: c.name,
      type: c.type,
      parentId: c.parentId,
      position: c.rawPosition,
      topic: 'topic' in c ? (c.topic ?? null) : null,
      nsfw: 'nsfw' in c ? c.nsfw : false,
      rateLimitPerUser: 'rateLimitPerUser' in c ? (c.rateLimitPerUser ?? 0) : 0,
      bitrate: 'bitrate' in c ? c.bitrate : null,
      userLimit: 'userLimit' in c ? c.userLimit : null,
      overwrites: c.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })),
    });
  }
  return {
    name: guild.name,
    verificationLevel: guild.verificationLevel,
    explicitContentFilter: guild.explicitContentFilter,
    defaultMessageNotifications: guild.defaultMessageNotifications,
    afkTimeout: guild.afkTimeout,
    afkChannelId: guild.afkChannelId,
    systemChannelId: guild.systemChannelId,
    roles: roles.sort((a, b) => a.position - b.position),
    channels: channels.sort((a, b) => a.position - b.position),
  };
}

export type RestoreMode = 'merge' | 'replace';

export interface RestorePlan {
  /** Backup role ID -> live role ID, for roles that already exist. */
  roleMatches: Map<string, string>;
  rolesToCreate: RoleSnapshot[];
  rolesToUpdate: { liveId: string; from: RoleSnapshot }[];
  rolesToDelete: string[];
  channelMatches: Map<string, string>;
  channelsToCreate: ChannelSnapshot[];
  channelsToUpdate: { liveId: string; from: ChannelSnapshot }[];
  channelsToDelete: string[];
}

function roleChanged(live: RoleSnapshot, from: RoleSnapshot): boolean {
  return live.name !== from.name || live.color !== from.color || live.hoist !== from.hoist || live.mentionable !== from.mentionable || live.permissions !== from.permissions;
}

/** Pairs backup items with live ones: by ID first (same server), then by name among the rest. */
function match<T extends { id: string; name: string }>(backup: readonly T[], live: readonly T[], sameKind: (a: T, b: T) => boolean): Map<string, string> {
  const matches = new Map<string, string>();
  const taken = new Set<string>();
  const liveById = new Map(live.map((l) => [l.id, l]));
  for (const b of backup) {
    const l = liveById.get(b.id);
    if (l && sameKind(b, l)) {
      matches.set(b.id, l.id);
      taken.add(l.id);
    }
  }
  for (const b of backup) {
    if (matches.has(b.id)) continue;
    const l = live.find((x) => !taken.has(x.id) && x.name === b.name && sameKind(b, x));
    if (l) {
      matches.set(b.id, l.id);
      taken.add(l.id);
    }
  }
  return matches;
}

/**
 * Works out what a restore has to do, without touching Discord. Merge mode only creates and
 * updates; replace mode also deletes roles and channels the backup doesn't have.
 */
export function planRestore(backup: GuildSnapshot, live: GuildSnapshot, mode: RestoreMode): RestorePlan {
  const roleMatches = match(backup.roles, live.roles, (a, b) => a.everyone === b.everyone && (a.managed === b.managed || a.everyone));
  const liveRoles = new Map(live.roles.map((r) => [r.id, r]));
  const rolesToCreate = backup.roles.filter((r) => !r.managed && !roleMatches.has(r.id));
  const rolesToUpdate = backup.roles
    .filter((r) => !r.managed && roleMatches.has(r.id))
    .map((r) => ({ liveId: roleMatches.get(r.id)!, from: r }))
    .filter(({ liveId, from }) => roleChanged(liveRoles.get(liveId)!, from));
  const matchedRoles = new Set(roleMatches.values());
  const rolesToDelete = mode === 'replace' ? live.roles.filter((r) => !r.everyone && !r.managed && !matchedRoles.has(r.id)).map((r) => r.id) : [];

  const channelMatches = match(backup.channels, live.channels, (a, b) => a.type === b.type);
  const channelsToCreate = backup.channels.filter((c) => !channelMatches.has(c.id));
  // Channel overwrites refer to roles by ID, so comparing them needs the role mapping too;
  // updating every matched channel is simpler and only costs one request each.
  const channelsToUpdate = backup.channels.filter((c) => channelMatches.has(c.id)).map((c) => ({ liveId: channelMatches.get(c.id)!, from: c }));
  const matchedChannels = new Set(channelMatches.values());
  const channelsToDelete = mode === 'replace' ? live.channels.filter((c) => !matchedChannels.has(c.id)).map((c) => c.id) : [];

  return { roleMatches, rolesToCreate, rolesToUpdate, rolesToDelete, channelMatches, channelsToCreate, channelsToUpdate, channelsToDelete };
}
