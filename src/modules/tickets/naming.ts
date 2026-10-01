/** Turns a pattern like "ticket-{number}-{user}" into a valid Discord channel name. */
export function channelName(pattern: string, vars: { number: number; user: string; category: string }): string {
  const slug = (text: string) =>
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const name = pattern
    .replace(/\{number\}/g, String(vars.number).padStart(4, '0'))
    .replace(/\{user\}/g, slug(vars.user) || 'user')
    .replace(/\{category\}/g, slug(vars.category) || 'ticket');
  return slug(name).slice(0, 100) || `ticket-${vars.number}`;
}
