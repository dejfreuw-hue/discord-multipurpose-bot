import { PermissionFlagsBits, type GuildMember, type Role } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { UserError } from '../src/core/errors.js';
import { assertAssignableRole } from '../src/core/permissions.js';
import { assertCanModerate } from '../src/modules/moderation/hierarchy.js';

function role(position: number, extra: Partial<{ id: string; managed: boolean }> = {}) {
  return {
    id: extra.id ?? `r${position}`,
    position,
    managed: extra.managed ?? false,
    comparePositionTo(other: { position: number }) {
      return this.position - other.position;
    },
  };
}

const guild = { id: 'guild', ownerId: 'owner', members: { me: undefined as unknown } };

function member(id: string, position: number, admin = false): GuildMember {
  return {
    id,
    guild,
    roles: { highest: role(position) },
    permissions: { has: (p: bigint) => admin && p === PermissionFlagsBits.Administrator },
    toString: () => `<@${id}>`,
  } as unknown as GuildMember;
}

const bot = member('bot', 50);
guild.members.me = bot;
(guild as unknown as { id: string }).id = 'guild';

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(UserError);
    return (err as UserError).key;
  }
  return 'allowed';
}

describe('assertCanModerate', () => {
  const mod = member('mod', 30);

  it('allows acting on lower members', async () => {
    expect(await rejection(assertCanModerate(member('user', 10), mod, 'ban'))).toBe('allowed');
  });

  it('blocks self, the bot and the owner', async () => {
    expect(await rejection(assertCanModerate(mod, mod, 'kick'))).toBe('moderation.errors.self');
    expect(await rejection(assertCanModerate(bot, mod, 'kick'))).toBe('moderation.errors.bot');
    expect(await rejection(assertCanModerate(member('owner', 1), mod, 'kick'))).toBe('moderation.errors.owner');
  });

  it('blocks members at or above the moderator', async () => {
    expect(await rejection(assertCanModerate(member('peer', 30), mod, 'ban'))).toBe('moderation.errors.userHierarchy');
  });

  it('blocks members above the bot even for the server owner', async () => {
    const owner = member('owner', 99);
    expect(await rejection(assertCanModerate(member('high', 60), owner, 'ban'))).toBe('moderation.errors.botHierarchy');
  });

  it('lets warnings ignore the bot hierarchy but not the moderator hierarchy', async () => {
    const admin = member('admin', 80);
    expect(await rejection(assertCanModerate(member('high', 60), admin, 'warn'))).toBe('allowed');
    expect(await rejection(assertCanModerate(member('high', 60), mod, 'warn'))).toBe('moderation.errors.userHierarchy');
  });

  it('refuses to time out administrators', async () => {
    expect(await rejection(assertCanModerate(member('admin', 10, true), mod, 'timeout'))).toBe('moderation.errors.timeoutAdmin');
  });

  it('checks only the bot when it acts on its own', async () => {
    expect(await rejection(assertCanModerate(member('user', 40), null, 'timeout'))).toBe('allowed');
    expect(await rejection(assertCanModerate(member('user', 60), null, 'timeout'))).toBe('moderation.errors.botHierarchy');
  });
});

describe('assertAssignableRole', () => {
  const mod = member('mod', 30);
  const asRole = (r: ReturnType<typeof role>) => ({ ...r, guild, toString: () => `<@&${r.id}>` }) as unknown as Role;

  it('allows roles below both the bot and the moderator', async () => {
    expect(await rejection(assertAssignableRole(asRole(role(20)), mod))).toBe('allowed');
  });

  it('rejects @everyone, managed roles and roles too high up', async () => {
    expect(await rejection(assertAssignableRole(asRole(role(0, { id: 'guild' })), mod))).toBe('errors.everyoneRole');
    expect(await rejection(assertAssignableRole(asRole(role(5, { managed: true })), mod))).toBe('errors.managedRole');
    expect(await rejection(assertAssignableRole(asRole(role(50)), mod))).toBe('errors.botRoleHierarchy');
    expect(await rejection(assertAssignableRole(asRole(role(40)), mod))).toBe('errors.userRoleHierarchy');
  });
});
