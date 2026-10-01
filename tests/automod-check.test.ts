import { PermissionFlagsBits, type GuildMember, type GuildTextBasedChannel, type Message } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { Bot } from '../src/core/bot.js';
import type { GuildSettingsData } from '../src/core/guild-settings.js';
import { checkMessage } from '../src/modules/automod/check.js';
import { isExempt } from '../src/modules/automod/enforce.js';
import { automodSettings, type AutomodSettings } from '../src/modules/automod/settings.js';

function settings(overrides: Record<string, unknown> = {}): AutomodSettings {
  return automodSettings.guildSettings.parse(overrides);
}

let nextId = 0;
function message(content: string, author = 'u'): Message<true> {
  return { id: String(++nextId), content, guildId: 'g', channelId: 'c', author: { id: author } } as unknown as Message<true>;
}

const fetchInvite = vi.fn(async (code: string) => ({ guild: { id: code === 'ours' ? 'g' : 'other' } }));
const bot = { client: { fetchInvite } } as unknown as Bot;

describe('checkMessage', () => {
  it('lets clean messages through', async () => {
    expect(await checkMessage(bot, message('hello there, how is everyone?'), settings(), false)).toBeNull();
  });

  it('flags invites to other servers but allows the own server', async () => {
    expect((await checkMessage(bot, message('join discord.gg/theirs'), settings(), false))?.filter).toBe('invites');
    expect(await checkMessage(bot, message('join discord.gg/ours'), settings(), false)).toBeNull();
  });

  it('checks mass mentions before anything else', async () => {
    const pings = Array.from({ length: 6 }, (_, i) => `<@1000000000000000${i}0>`).join(' ');
    const result = await checkMessage(bot, message(`${pings} discord.gg/theirs`), settings(), false);
    expect(result).toEqual({ filter: 'mentions', detail: '6' });
  });

  it('only runs filters that are enabled', async () => {
    const off = settings({ filters: { caps: { enabled: false } } });
    const on = settings({ filters: { caps: { enabled: true } } });
    expect(await checkMessage(bot, message('THIS IS VERY LOUD TEXT'), off, false)).toBeNull();
    expect((await checkMessage(bot, message('THIS IS VERY LOUD TEXT'), on, false))?.filter).toBe('caps');
  });

  it('hides the matched bad word in a spoiler for the log', async () => {
    const s = settings({ filters: { badWords: { enabled: true, words: ['scam*'] } } });
    expect(await checkMessage(bot, message('free nitro scamming'), s, false)).toEqual({ filter: 'badWords', detail: '||scamming||' });
  });

  it('counts spam on new messages only', async () => {
    const s = settings({ filters: { spam: { enabled: true, messages: 3, seconds: 5, duplicates: 10 } } });
    expect(await checkMessage(bot, message('a', 'spammer'), s, false)).toBeNull();
    expect(await checkMessage(bot, message('b', 'spammer'), s, true)).toBeNull();
    expect(await checkMessage(bot, message('c', 'spammer'), s, false)).toBeNull();
    const hit = await checkMessage(bot, message('d', 'spammer'), s, false);
    expect(hit?.filter).toBe('spam');
    expect(hit?.related).toHaveLength(3);
  });
});

describe('isExempt', () => {
  const core = { staffRoles: ['staff'] } as unknown as GuildSettingsData;
  const member = (roles: string[], admin = false) =>
    ({
      id: 'm',
      guild: { ownerId: 'owner' },
      permissions: { has: (p: bigint) => admin && p === PermissionFlagsBits.Administrator },
      roles: { cache: new Map(roles.map((r) => [r, {}])) },
    }) as unknown as GuildMember;
  const channel = (id: string, parentId: string | null = null, thread = false, grandparent: string | null = null) =>
    ({ id, parentId, isThread: () => thread, parent: { parentId: grandparent } }) as unknown as GuildTextBasedChannel;

  it('exempts admins and staff, but staff only while exemptStaff is on', () => {
    expect(isExempt(member([], true), channel('c'), core, settings())).toBe(true);
    expect(isExempt(member(['staff']), channel('c'), core, settings())).toBe(true);
    expect(isExempt(member(['staff']), channel('c'), core, settings({ exemptStaff: false }))).toBe(false);
  });

  it('exempts whitelisted roles', () => {
    expect(isExempt(member(['trusted']), channel('c'), core, settings({ whitelistRoles: ['trusted'] }))).toBe(true);
    expect(isExempt(member([]), channel('c'), core, settings({ whitelistRoles: ['trusted'] }))).toBe(false);
  });

  it('covers channels, their threads and whole categories', () => {
    const s = settings({ whitelistChannels: ['memes', 'offtopic-category'] });
    expect(isExempt(member([]), channel('memes'), core, s)).toBe(true);
    expect(isExempt(member([]), channel('thread', 'memes', true), core, s)).toBe(true);
    expect(isExempt(member([]), channel('general', 'offtopic-category'), core, s)).toBe(true);
    expect(isExempt(member([]), channel('thread', 'general', true, 'offtopic-category'), core, s)).toBe(true);
    expect(isExempt(member([]), channel('rules', 'info'), core, s)).toBe(false);
  });
});
