/**
 * A stable key for an emoji as typed by an admin ("<:name:id>", "<a:name:id>" or a unicode
 * emoji), matching what Discord reports on a reaction: the id for custom emojis, else the text.
 */
export function emojiKey(raw: string): string {
  const custom = /^<a?:\w{2,32}:(\d{17,20})>$/.exec(raw.trim());
  return custom ? custom[1]! : raw.trim();
}

/** The same key for an emoji Discord reports on a reaction. */
export function reactionKey(emoji: { id: string | null; name: string | null }): string {
  return emoji.id ?? emoji.name ?? '';
}

/** Rough check that admin input is a single emoji rather than a word. */
export function looksLikeEmoji(raw: string): boolean {
  const text = raw.trim();
  if (/^<a?:\w{2,32}:\d{17,20}>$/.test(text)) return true;
  return text.length <= 16 && /^[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(text) && !/[\p{L}\p{N}\s]/u.test(text);
}
