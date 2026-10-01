/*
 * The content checks, kept free of discord.js so they can be unit tested on plain strings.
 * Each returns what matched (for the log) or null.
 */

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '!': 'i', '|': 'l' };
const ZERO_WIDTH = /[\u200b-\u200f\u2060\ufeff]/g;
const INVITE = /(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg)\/([a-z0-9-]{2,32})/gi;
const URL_LIKE = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const USER_MENTION = /<@!?(\d{17,20})>/g;
const ROLE_MENTION = /<@&(\d{17,20})>/g;
const MASS_MENTION = /@(?:everyone|here)\b/;
// Mentions, custom emojis and links don't count as shouting.
const NOT_TEXT = /<(?:@[!&]?|#|a?:\w+:)\d+>|\b(?:https?:\/\/|www\.)\S+/g;

/** Lowercases, strips accents and zero-width characters, and undoes common letter swaps (h3ll0 -> hello). */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(ZERO_WIDTH, '')
    .toLowerCase()
    .replace(/[0134578@$!|]/g, (c) => LEET[c] ?? c);
}

/** Joins words spelled out with separators ("b a d", "b.a.d") so they can't dodge the filter. */
function collapseSpelledOut(text: string): string {
  return text.replace(/\b(?:[a-z][\s._*-]+){2,}[a-z]\b/g, (run) => run.replace(/[\s._*-]+/g, ''));
}

const compiled = new Map<string, RegExp | null>();

/**
 * Builds one regex for a word list. Words match on their own, not inside other words, so
 * "ass" doesn't flag "class". A trailing or leading "*" allows anything there: "idiot*".
 */
export function compileWords(words: readonly string[]): RegExp | null {
  const key = words.join('\n');
  if (compiled.has(key)) return compiled.get(key)!;
  const parts = words
    .map((w) => normalize(w.trim()))
    .filter(Boolean)
    .map((w) => w.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[a-z]*'));
  const regex = parts.length > 0 ? new RegExp(`(?<![a-z0-9])(?:${parts.join('|')})(?![a-z0-9])`, 'i') : null;
  if (compiled.size > 200) compiled.clear();
  compiled.set(key, regex);
  return regex;
}

export function findBadWord(content: string, words: readonly string[]): string | null {
  const regex = compileWords(words);
  if (!regex) return null;
  const text = normalize(content);
  return regex.exec(text)?.[0] ?? regex.exec(collapseSpelledOut(text))?.[0] ?? null;
}

export function findInviteCodes(content: string): string[] {
  return [...content.replace(ZERO_WIDTH, '').matchAll(INVITE)].map((m) => m[1]!);
}

function hostOf(raw: string): string | null {
  try {
    return new URL(raw.startsWith('www.') ? `http://${raw}` : raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** The first linked host that isn't on the allowlist (subdomains of allowed domains are fine). */
export function findBlockedLink(content: string, allowedDomains: readonly string[]): string | null {
  const allowed = allowedDomains.map((d) => d.toLowerCase().replace(/^www\./, ''));
  for (const match of content.replace(ZERO_WIDTH, '').matchAll(URL_LIKE)) {
    const host = hostOf(match[0]);
    if (!host) continue;
    if (!allowed.some((d) => host === d || host.endsWith(`.${d}`))) return host;
  }
  return null;
}

/** Unique user and role mentions, plus one for an @everyone/@here attempt. */
export function countMentions(content: string): number {
  const users = new Set([...content.matchAll(USER_MENTION)].map((m) => m[1]));
  const roles = new Set([...content.matchAll(ROLE_MENTION)].map((m) => m[1]));
  return users.size + roles.size + (MASS_MENTION.test(content) ? 1 : 0);
}

/** Percentage of uppercase letters, or null when there are fewer than `minLength` letters. */
export function capsPercent(content: string, minLength: number): number | null {
  const text = content.replace(NOT_TEXT, '');
  const upper = text.match(/\p{Lu}/gu)?.length ?? 0;
  const lower = text.match(/\p{Ll}/gu)?.length ?? 0;
  const letters = upper + lower;
  if (letters < minLength) return null;
  return Math.round((upper / letters) * 100);
}
