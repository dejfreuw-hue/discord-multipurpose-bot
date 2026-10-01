import { ChannelType, Collection, OverwriteType } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { restoreBackup } from '../src/modules/backup/restore.js';
import { planRestore, type ChannelSnapshot, type GuildSnapshot, type RoleSnapshot } from '../src/modules/backup/snapshot.js';

const role = (id: string, name: string, position: number, extra: Partial<RoleSnapshot> = {}): RoleSnapshot => ({
  id,
  name,
  color: 0,
  hoist: false,
  mentionable: false,
  permissions: '0',
  position,
  everyone: false,
  managed: false,
  ...extra,
});

const channel = (id: string, name: string, type: ChannelType, extra: Partial<ChannelSnapshot> = {}): ChannelSnapshot => ({
  id,
  name,
  type,
  parentId: null,
  position: 0,
  topic: null,
  nsfw: false,
  rateLimitPerUser: 0,
  bitrate: null,
  userLimit: null,
  overwrites: [],
  ...extra,
});

const snapshot = (roles: RoleSnapshot[], channels: ChannelSnapshot[]): GuildSnapshot => ({
  name: 'S',
  verificationLevel: 1,
  explicitContentFilter: 0,
  defaultMessageNotifications: 1,
  afkTimeout: 300,
  afkChannelId: null,
  systemChannelId: null,
  roles,
  channels,
});

describe('planRestore', () => {
  const everyoneOld = role('old-guild', '@everyone', 0, { everyone: true, permissions: '1024' });
  const backup = snapshot(
    [everyoneOld, role('r-mod', 'Mod', 2, { permissions: '8192' }), role('r-vip', 'VIP', 1), role('r-bot', 'SomeBot', 3, { managed: true })],
    [channel('c-cat', 'Info', ChannelType.GuildCategory), channel('c-rules', 'rules', ChannelType.GuildText, { parentId: 'c-cat' })],
  );

  it('matches by name on another server and creates what is missing', () => {
    const live = snapshot(
      [role('new-guild', '@everyone', 0, { everyone: true }), role('x-mod', 'Mod', 1, { permissions: '8192' }), role('x-extra', 'Extra', 2)],
      [channel('y-rules', 'rules', ChannelType.GuildText), channel('y-voice', 'rules', ChannelType.GuildVoice)],
    );
    const plan = planRestore(backup, live, 'merge');
    expect(plan.roleMatches.get('r-mod')).toBe('x-mod');
    expect(plan.roleMatches.get('old-guild')).toBe('new-guild');
    expect(plan.rolesToCreate.map((r) => r.name)).toEqual(['VIP']);
    // Mod is identical, so only @everyone (different permissions) needs an update.
    expect(plan.rolesToUpdate.map((u) => u.liveId)).toEqual(['new-guild']);
    // A voice channel with the same name is a different channel.
    expect(plan.channelMatches.get('c-rules')).toBe('y-rules');
    expect(plan.channelsToCreate.map((c) => c.name)).toEqual(['Info']);
    expect(plan.rolesToDelete).toEqual([]);
    expect(plan.channelsToDelete).toEqual([]);
  });

  it('never creates managed roles and only deletes in replace mode', () => {
    const live = snapshot(
      [role('g', '@everyone', 0, { everyone: true }), role('x-extra', 'Extra', 1), role('x-int', 'Integration', 2, { managed: true })],
      [channel('y-old', 'old-chat', ChannelType.GuildText)],
    );
    const plan = planRestore(backup, live, 'replace');
    expect(plan.rolesToCreate.map((r) => r.name)).not.toContain('SomeBot');
    expect(plan.rolesToDelete).toEqual(['x-extra']);
    expect(plan.channelsToDelete).toEqual(['y-old']);
  });

  it('matches by ID first when restoring onto the same server', () => {
    const live = snapshot([role('old-guild', '@everyone', 0, { everyone: true }), role('r-mod', 'Moderators', 1)], []);
    const plan = planRestore(backup, live, 'merge');
    expect(plan.roleMatches.get('r-mod')).toBe('r-mod');
    expect(plan.rolesToUpdate.find((u) => u.liveId === 'r-mod')?.from.name).toBe('Mod');
  });
});

describe('restoreBackup', () => {
  function fakeGuild() {
    let nextId = 0;
    const calls: string[] = [];
    const roles = new Collection<string, unknown>();
    const channels = new Collection<string, unknown>();
    const addRole = (id: string, name: string, position: number, managed = false) => {
      roles.set(id, {
        id,
        name,
        position,
        managed,
        hoist: false,
        mentionable: false,
        colors: { primaryColor: 0 },
        permissions: { bitfield: 0n },
        comparePositionTo: (other: { position: number }) => position - other.position,
      });
    };
    addRole('g', '@everyone', 0);
    addRole('top', 'Owner', 10);
    addRole('bot', 'Bot', 5, true);
    addRole('low', 'Old', 1);
    const addChannel = (id: string, name: string, type: ChannelType) =>
      channels.set(id, {
        id,
        name,
        type,
        parentId: null,
        rawPosition: 0,
        isThread: () => false,
        permissionOverwrites: { cache: new Collection() },
        edit: vi.fn(async () => calls.push(`edit-channel:${name}`)),
      });
    addChannel('here', 'command-channel', ChannelType.GuildText);
    addChannel('gone', 'stale', ChannelType.GuildText);

    const created: { name: string; parent: unknown; permissionOverwrites: { id: string }[] }[] = [];
    const guild = {
      id: 'g',
      maximumBitrate: 96000,
      roles: {
        cache: roles,
        everyone: { setPermissions: vi.fn(async () => calls.push('everyone')) },
        create: vi.fn(async (o: { name: string }) => {
          const id = `new-role-${++nextId}`;
          addRole(id, o.name, 1);
          calls.push(`create-role:${o.name}`);
          return { id };
        }),
        edit: vi.fn(async () => calls.push('edit-role')),
        delete: vi.fn(async (id: string) => calls.push(`delete-role:${id}`)),
        setPositions: vi.fn(async () => undefined),
      },
      channels: {
        cache: channels,
        create: vi.fn(async (o: { name: string; type: ChannelType; parent: unknown; permissionOverwrites: { id: string }[] }) => {
          const id = `new-channel-${++nextId}`;
          addChannel(id, o.name, o.type);
          created.push(o);
          calls.push(`create-channel:${o.name}`);
          return { id };
        }),
        delete: vi.fn(async (id: string) => calls.push(`delete-channel:${id}`)),
        setPositions: vi.fn(async () => undefined),
      },
      members: {
        me: { roles: { highest: { comparePositionTo: (other: { position: number }) => 5 - other.position } } },
        fetch: vi.fn(async () => new Collection([['member-1', {}]])),
      },
      edit: vi.fn(async () => undefined),
    };
    return { guild, calls, created };
  }

  const backup = snapshot(
    [role('old-g', '@everyone', 0, { everyone: true, permissions: '1024' }), role('old-mod', 'Mod', 2), role('old-owner', 'Owner', 3, { permissions: '8' })],
    [
      channel('old-text', 'staff', ChannelType.GuildText, {
        parentId: 'old-cat',
        overwrites: [
          { id: 'old-mod', type: OverwriteType.Role, allow: '1024', deny: '0' },
          { id: 'old-g', type: OverwriteType.Role, allow: '0', deny: '1024' },
          { id: 'member-1', type: OverwriteType.Member, allow: '1024', deny: '0' },
          { id: 'member-left', type: OverwriteType.Member, allow: '1024', deny: '0' },
        ],
      }),
      channel('old-cat', 'Staff', ChannelType.GuildCategory),
    ],
  );

  it('creates roles before channels and categories before their channels, remapping overwrites', async () => {
    const { guild, calls, created } = fakeGuild();
    const report = await restoreBackup(guild as never, backup, { mode: 'merge', settings: false, keepChannelId: 'here' });

    expect(calls.indexOf('create-role:Mod')).toBeLessThan(calls.indexOf('create-channel:Staff'));
    expect(calls.indexOf('create-channel:Staff')).toBeLessThan(calls.indexOf('create-channel:staff'));
    const staff = created.find((c) => c.name === 'staff')!;
    expect(staff.parent).toBeTruthy();
    // Mod and @everyone point at this server's roles; the member who left is dropped.
    expect(staff.permissionOverwrites.map((o) => o.id)).toEqual([expect.stringMatching(/^new-role-/), 'g', 'member-1']);
    // "Owner" exists here above the bot's role, so it can't be changed.
    expect(report.skipped).toBe(1);
    expect(calls).not.toContain('edit-role');
  });

  it('deletes extras in replace mode but keeps the channel the restore runs in and roles above the bot', async () => {
    const { guild, calls } = fakeGuild();
    await restoreBackup(guild as never, backup, { mode: 'replace', settings: false, keepChannelId: 'here' });
    expect(calls).toContain('delete-channel:gone');
    expect(calls).not.toContain('delete-channel:here');
    expect(calls).toContain('delete-role:low');
    expect(calls.some((c) => c === 'delete-role:bot' || c === 'delete-role:top')).toBe(false);
  });
});
