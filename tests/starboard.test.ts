import { Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { emojiKey, looksLikeEmoji, reactionKey } from '../src/core/emoji.js';
import { countStars } from '../src/modules/community/starboard/board.js';

function message(count: number, reactors: string[], emoji = { id: null as string | null, name: '⭐' as string | null }) {
  const reaction = { emoji, count, users: { fetch: vi.fn(async () => new Collection(reactors.map((id) => [id, { id }]))) } };
  return { author: { id: 'author' }, reactions: { cache: new Collection([['r', reaction]]) } } as never;
}

describe('countStars', () => {
  it('leaves out the author', async () => {
    expect(await countStars(message(3, ['author', 'a', 'b']), '⭐', false)).toBe(2);
    expect(await countStars(message(3, ['author', 'a', 'b']), '⭐', true)).toBe(3);
  });

  it('counts only the configured emoji', async () => {
    expect(await countStars(message(3, ['a', 'b', 'c']), '\u{1F525}', false)).toBe(0);
  });

  it('matches custom emojis by id', async () => {
    const custom = message(2, ['a', 'b'], { id: '123456789012345678', name: 'gold' });
    expect(await countStars(custom, '<:gold:123456789012345678>', false)).toBe(2);
  });
});

describe('emoji helpers', () => {
  it('gives typed and reported emojis the same key', () => {
    expect(emojiKey('<a:spin:123456789012345678>')).toBe(reactionKey({ id: '123456789012345678', name: 'spin' }));
    expect(emojiKey('⭐')).toBe(reactionKey({ id: null, name: '⭐' }));
  });

  it('tells emojis from words', () => {
    expect(looksLikeEmoji('⭐')).toBe(true);
    expect(looksLikeEmoji('\u{1F44D}\u{1F3FD}')).toBe(true);
    expect(looksLikeEmoji('\u{1F1FA}\u{1F1F8}')).toBe(true);
    expect(looksLikeEmoji('<:pepe:123456789012345678>')).toBe(true);
    expect(looksLikeEmoji('star')).toBe(false);
    expect(looksLikeEmoji('⭐ star')).toBe(false);
  });
});
