import { Collection } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { countFor, counterName, needsMemberList } from '../src/modules/community/serverstats/counters.js';

describe('counterName', () => {
  it('fills the count with locale formatting', () => {
    expect(counterName('Members: {count}', 12345, 'en-US')).toBe('Members: 12,345');
    expect(counterName('Mitglieder: {count}', 12345, 'de')).toBe('Mitglieder: 12.345');
  });

  it('appends the count when the template has no placeholder', () => {
    expect(counterName('Members', 7, 'en')).toBe('Members 7');
  });

  it('stays within the channel name limit', () => {
    expect(counterName('x'.repeat(98) + ' {count}', 1000, 'en')).toHaveLength(100);
  });
});

describe('countFor', () => {
  const member = (bot: boolean) => ({ user: { bot } });
  const guild = {
    memberCount: 5,
    premiumSubscriptionCount: 2,
    members: { cache: new Collection([['a', member(false)], ['b', member(false)], ['c', member(true)]]) },
    roles: { cache: new Collection([['everyone', {}], ['mod', {}]]) },
    channels: {
      cache: new Collection([
        ['t', { isThread: () => false, isDMBased: () => false }],
        ['th', { isThread: () => true, isDMBased: () => false }],
      ]),
    },
  } as never;

  it('counts each kind', () => {
    expect(countFor(guild, 'members')).toBe(5);
    expect(countFor(guild, 'humans')).toBe(2);
    expect(countFor(guild, 'bots')).toBe(1);
    expect(countFor(guild, 'boosts')).toBe(2);
    expect(countFor(guild, 'roles')).toBe(1);
    expect(countFor(guild, 'channels')).toBe(1);
  });

  it('knows which kinds need the member list', () => {
    expect(needsMemberList(['members', 'boosts'])).toBe(false);
    expect(needsMemberList(['members', 'bots'])).toBe(true);
  });
});
