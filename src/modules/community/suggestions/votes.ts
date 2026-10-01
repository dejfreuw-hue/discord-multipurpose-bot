/** Share of upvotes as a whole percentage, or null with no votes. */
export function approval(up: number, down: number): number | null {
  return up + down === 0 ? null : Math.round((up / (up + down)) * 100);
}
