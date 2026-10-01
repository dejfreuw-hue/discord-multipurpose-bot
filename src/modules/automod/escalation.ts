import type { LadderStep } from './settings.js';

/**
 * The punishment to apply when a member's active strikes go from `before` to `after`: the
 * highest step crossed by this change, or null. Steps are only triggered by crossing them, so a
 * member sitting above a threshold isn't punished again for the same step.
 */
export function stepFor(ladder: readonly LadderStep[], before: number, after: number): LadderStep | null {
  let chosen: LadderStep | null = null;
  for (const step of ladder) {
    if (step.strikes > before && step.strikes <= after && (!chosen || step.strikes > chosen.strikes)) chosen = step;
  }
  return chosen;
}
