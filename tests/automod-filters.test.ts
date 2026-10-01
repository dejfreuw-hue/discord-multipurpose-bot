import { describe, expect, it } from 'vitest';
import { capsPercent, countMentions, findBadWord, findBlockedLink, findInviteCodes, normalize } from '../src/modules/automod/filters.js';

describe('normalize', () => {
  it('undoes leetspeak, accents and zero-width tricks', () => {
    expect(normalize('H3ll0 W0rld')).toBe('hello world');
    expect(normalize('crème brûlée')).toBe('creme brulee');
    expect(normalize('sp\u200bam')).toBe('spam');
  });
});

describe('findBadWord', () => {
  const words = ['idiot', 'scam*', 'ass'];

  it('matches whole words in any case', () => {
    expect(findBadWord('you IDIOT', words)).toBe('idiot');
  });

  it('does not flag words that merely contain a bad word', () => {
    expect(findBadWord('first class assignment', words)).toBeNull();
  });

  it('supports wildcards', () => {
    expect(findBadWord('total scammer here', words)).toBe('scammer');
  });

  it('sees through leetspeak and spelled-out words', () => {
    expect(findBadWord('1d10t', words)).toBe('idiot');
    expect(findBadWord('you are an i d i o t', words)).toBe('idiot');
    expect(findBadWord('i.d.i.o.t', words)).toBe('idiot');
  });

  it('returns null for an empty list', () => {
    expect(findBadWord('anything', [])).toBeNull();
  });
});

describe('findInviteCodes', () => {
  it('finds invite codes in every common form', () => {
    expect(findInviteCodes('join discord.gg/abc123 or https://discord.com/invite/xyz-9 and discordapp.com/invite/old')).toEqual([
      'abc123',
      'xyz-9',
      'old',
    ]);
  });

  it('ignores normal discord links', () => {
    expect(findInviteCodes('https://discord.com/channels/1/2')).toEqual([]);
  });
});

describe('findBlockedLink', () => {
  const allowed = ['youtube.com', 'tenor.com'];

  it('allows listed domains and their subdomains', () => {
    expect(findBlockedLink('https://www.youtube.com/watch?v=1 https://media.tenor.com/x.gif', allowed)).toBeNull();
  });

  it('returns the first host that is not allowed', () => {
    expect(findBlockedLink('see www.evil.example/path', allowed)).toBe('evil.example');
    expect(findBlockedLink('https://youtube.com.evil.example', allowed)).toBe('youtube.com.evil.example');
  });

  it('ignores text without links', () => {
    expect(findBlockedLink('no links in here.com probably', allowed)).toBeNull();
  });
});

describe('countMentions', () => {
  it('counts unique users and roles plus mass mentions', () => {
    const content = '<@111111111111111111> <@!111111111111111111> <@222222222222222222> <@&333333333333333333> @everyone';
    expect(countMentions(content)).toBe(4);
  });
});

describe('capsPercent', () => {
  it('ignores short messages', () => {
    expect(capsPercent('OK LOL', 12)).toBeNull();
  });

  it('measures shouting without counting mentions or emojis', () => {
    expect(capsPercent('WHY IS EVERYONE SO LOUD', 12)).toBe(100);
    expect(capsPercent('<@111111111111111111> <:KEKW:123456789012345678> this is fine text', 12)).toBe(0);
  });
});
