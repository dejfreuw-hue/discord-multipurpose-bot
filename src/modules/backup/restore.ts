import {
  ChannelType,
  OverwriteType,
  type CategoryChannel,
  type Guild,
  type GuildChannel,
  type GuildChannelCreateOptions,
  type OverwriteResolvable,
} from 'discord.js';
import { planRestore, takeSnapshot, type ChannelSnapshot, type GuildSnapshot, type RestoreMode } from './snapshot.js';

export interface RestoreReport {
  created: number;
  updated: number;
  deleted: number;
  /** Roles above the bot, channels Discord refused (e.g. announcement channels outside Community servers). */
  skipped: number;
}

interface RestoreOptions {
  mode: RestoreMode;
  settings: boolean;
  /** The channel the restore was started from survives replace mode, so the result can be posted. */
  keepChannelId: string | null;
}

async function attempt(report: RestoreReport, field: 'created' | 'updated' | 'deleted', task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
    report[field]++;
  } catch {
    report.skipped++;
  }
}

function mapOverwrites(overwrites: ChannelSnapshot['overwrites'], roles: Map<string, string>, members: Set<string>): OverwriteResolvable[] {
  const out: OverwriteResolvable[] = [];
  for (const o of overwrites) {
    const id = o.type === OverwriteType.Role ? roles.get(o.id) : members.has(o.id) ? o.id : undefined;
    if (id) out.push({ id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) });
  }
  return out;
}

/**
 * Rebuilds roles, channels and permissions from a backup. Everything the bot can't do is skipped
 * and counted rather than aborting halfway, so a restore always gets as far as it can.
 */
export async function restoreBackup(guild: Guild, backup: GuildSnapshot, options: RestoreOptions): Promise<RestoreReport> {
  const report: RestoreReport = { created: 0, updated: 0, deleted: 0, skipped: 0 };
  const plan = planRestore(backup, takeSnapshot(guild), options.mode);
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const below = (roleId: string) => {
    const role = guild.roles.cache.get(roleId);
    return Boolean(role && me.roles.highest.comparePositionTo(role) > 0);
  };

  // Roles first, since channel permissions point at them.
  const roleMap = new Map(plan.roleMatches);
  const everyone = backup.roles.find((r) => r.everyone);
  if (everyone) roleMap.set(everyone.id, guild.id);
  for (const role of plan.rolesToCreate) {
    await attempt(report, 'created', async () => {
      const created = await guild.roles.create({
        name: role.name,
        colors: { primaryColor: role.color },
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: BigInt(role.permissions),
        reason: 'Backup restore',
      });
      roleMap.set(role.id, created.id);
    });
  }
  for (const { liveId, from } of plan.rolesToUpdate) {
    if (liveId !== guild.id && !below(liveId)) {
      report.skipped++;
      continue;
    }
    const permissions = BigInt(from.permissions);
    await attempt(report, 'updated', () =>
      liveId === guild.id
        ? guild.roles.everyone.setPermissions(permissions, 'Backup restore')
        : guild.roles.edit(liveId, { name: from.name, colors: { primaryColor: from.color }, hoist: from.hoist, mentionable: from.mentionable, permissions, reason: 'Backup restore' }),
    );
  }
  // Put the bot's reachable roles back in backup order; Discord rejects moves above the bot.
  const order = backup.roles
    .filter((r) => !r.everyone)
    .map((r) => roleMap.get(r.id))
    .filter((id): id is string => Boolean(id) && below(id!));
  await guild.roles.setPositions(order.map((role, i) => ({ role, position: i + 1 }))).catch(() => undefined);

  const memberIds = new Set<string>();
  const wanted = [...new Set(backup.channels.flatMap((c) => c.overwrites.filter((o) => o.type === OverwriteType.Member).map((o) => o.id)))];
  // Member overwrites only make sense for people who are in this server.
  for (let i = 0; i < wanted.length; i += 100) {
    const found = await guild.members.fetch({ user: wanted.slice(i, i + 100) }).catch(() => null);
    for (const id of found?.keys() ?? []) memberIds.add(id);
  }

  // Categories before the channels inside them.
  const channelMap = new Map(plan.channelMatches);
  const byCategoryFirst = (a: ChannelSnapshot, b: ChannelSnapshot) =>
    Number(b.type === ChannelType.GuildCategory) - Number(a.type === ChannelType.GuildCategory) || a.position - b.position;
  const fields = (c: ChannelSnapshot) => {
    const parentId = c.parentId ? channelMap.get(c.parentId) : undefined;
    return {
      name: c.name,
      topic: c.topic ?? undefined,
      nsfw: c.nsfw,
      rateLimitPerUser: c.rateLimitPerUser,
      ...(c.bitrate ? { bitrate: Math.min(c.bitrate, guild.maximumBitrate) } : {}),
      ...(c.userLimit !== null ? { userLimit: c.userLimit } : {}),
      parent: parentId ? (guild.channels.cache.get(parentId) as CategoryChannel | undefined) : null,
      permissionOverwrites: mapOverwrites(c.overwrites, roleMap, memberIds),
    };
  };
  for (const c of [...plan.channelsToCreate].sort(byCategoryFirst)) {
    await attempt(report, 'created', async () => {
      const created = await guild.channels.create({ ...fields(c), type: c.type, reason: 'Backup restore' } as GuildChannelCreateOptions);
      channelMap.set(c.id, created.id);
    });
  }
  for (const { liveId, from } of [...plan.channelsToUpdate].sort((a, b) => byCategoryFirst(a.from, b.from))) {
    const channel = guild.channels.cache.get(liveId) as GuildChannel | undefined;
    if (!channel) continue;
    await attempt(report, 'updated', () => channel.edit({ ...fields(from), lockPermissions: false, reason: 'Backup restore' }));
  }
  await guild.channels
    .setPositions(backup.channels.flatMap((c) => (channelMap.has(c.id) ? [{ channel: channelMap.get(c.id)!, position: c.position }] : [])))
    .catch(() => undefined);

  if (options.mode === 'replace') {
    for (const id of plan.channelsToDelete) {
      if (id === options.keepChannelId) continue;
      await attempt(report, 'deleted', () => guild.channels.delete(id, 'Backup restore'));
    }
    for (const id of plan.rolesToDelete) {
      if (!below(id)) {
        report.skipped++;
        continue;
      }
      await attempt(report, 'deleted', () => guild.roles.delete(id, 'Backup restore'));
    }
  }

  if (options.settings) {
    const channel = (id: string | null) => (id ? (channelMap.get(id) ?? null) : null);
    await guild
      .edit({
        verificationLevel: backup.verificationLevel,
        explicitContentFilter: backup.explicitContentFilter,
        defaultMessageNotifications: backup.defaultMessageNotifications,
        afkTimeout: backup.afkTimeout,
        afkChannel: channel(backup.afkChannelId),
        systemChannel: channel(backup.systemChannelId),
        reason: 'Backup restore',
      })
      .then(() => report.updated++, () => report.skipped++);
  }
  return report;
}
