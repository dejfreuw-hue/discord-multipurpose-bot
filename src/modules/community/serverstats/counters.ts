import type { Guild } from 'discord.js';

export const COUNTER_KINDS = ['members', 'humans', 'bots', 'boosts', 'channels', 'roles'] as const;
export type CounterKind = (typeof COUNTER_KINDS)[number];

/** Kinds that need the full member list rather than the member count Discord sends for free. */
const NEEDS_MEMBERS: readonly CounterKind[] = ['humans', 'bots'];

export function needsMemberList(kinds: readonly CounterKind[]): boolean {
  return kinds.some((k) => NEEDS_MEMBERS.includes(k));
}

export function countFor(guild: Guild, kind: CounterKind): number {
  switch (kind) {
    case 'members':
      return guild.memberCount;
    case 'humans':
      return guild.members.cache.filter((m) => !m.user.bot).size;
    case 'bots':
      return guild.members.cache.filter((m) => m.user.bot).size;
    case 'boosts':
      return guild.premiumSubscriptionCount ?? 0;
    case 'channels':
      return guild.channels.cache.filter((c) => !c.isThread() && !c.isDMBased()).size;
    case 'roles':
      // Leave out @everyone, which every server has.
      return guild.roles.cache.size - 1;
  }
}

/** Channel name for a counter, kept under Discord's 100 character limit. */
export function counterName(template: string, count: number, locale: string): string {
  const formatted = new Intl.NumberFormat(locale).format(count);
  const name = template.includes('{count}') ? template.replace(/\{count\}/g, formatted) : `${template} ${formatted}`;
  return name.slice(0, 100);
}
