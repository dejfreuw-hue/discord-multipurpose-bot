export interface Entrant {
  id: string;
  /** Number of entries: 1 plus any bonus. 0 or less means not eligible. */
  weight: number;
}

/**
 * Picks up to `count` different winners, each pick weighted by entries. A member with 3 entries
 * is three times as likely to win as one with 1, but can still only win once.
 */
export function pickWinners(entrants: readonly Entrant[], count: number, random: () => number = Math.random): string[] {
  const pool = entrants.filter((e) => e.weight > 0).map((e) => ({ ...e }));
  const winners: string[] = [];
  while (winners.length < count && pool.length > 0) {
    const total = pool.reduce((sum, e) => sum + e.weight, 0);
    let roll = random() * total;
    let index = pool.findIndex((e) => (roll -= e.weight) < 0);
    if (index === -1) index = pool.length - 1;
    winners.push(pool[index]!.id);
    pool.splice(index, 1);
  }
  return winners;
}

export interface BonusRules {
  boosterEntries: number;
  bonusRoles: { roleId: string; entries: number }[];
}

/** Entries for one member: 1, plus the booster bonus, plus the bonus of every bonus role they hold. */
export function entriesFor(member: { boosting: boolean; roles: ReadonlySet<string> }, rules: BonusRules): number {
  let entries = 1;
  if (member.boosting) entries += rules.boosterEntries;
  for (const bonus of rules.bonusRoles) if (member.roles.has(bonus.roleId)) entries += bonus.entries;
  return entries;
}
