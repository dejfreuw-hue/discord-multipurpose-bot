import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { CARD_HEIGHT, CARD_WIDTH, compact, prepareBackground, renderRankCard } from '../src/modules/leveling/card.js';
import { eligibleVoiceMembers, type VoiceMember } from '../src/modules/leveling/voice.js';

describe('eligibleVoiceMembers', () => {
  const m = (userId: string, channelId: string, extra: Partial<VoiceMember> = {}): VoiceMember => ({ userId, channelId, bot: false, deaf: false, ...extra });

  it('requires company when requireOthers is on', () => {
    const members = [m('a', 'c1'), m('b', 'c1'), m('c', 'c2')];
    expect(eligibleVoiceMembers(members, null, true)).toEqual(['a', 'b']);
    expect(eligibleVoiceMembers(members, null, false)).toEqual(['a', 'b', 'c']);
  });

  it('does not count bots or deafened members as company', () => {
    const members = [m('a', 'c1'), m('bot', 'c1', { bot: true }), m('d', 'c1', { deaf: true })];
    expect(eligibleVoiceMembers(members, null, true)).toEqual([]);
  });

  it('never rewards the AFK channel', () => {
    expect(eligibleVoiceMembers([m('a', 'afk'), m('b', 'afk')], 'afk', false)).toEqual([]);
  });
});

describe('rank card', () => {
  const labels = { rank: 'RANK', level: 'LEVEL', xp: 'XP' };
  const isPng = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  it('renders a PNG with and without images', async () => {
    const plain = await renderRankCard({
      displayName: 'Ana',
      username: 'ana',
      avatar: null,
      background: null,
      preset: 'unknown-preset',
      accent: 0x5865f2,
      rank: null,
      level: 0,
      current: 0,
      needed: 100,
      labels,
    });
    expect(isPng(plain)).toBe(true);

    const square = createCanvas(64, 64).toBuffer('image/png');
    const withImages = await renderRankCard({
      displayName: 'x'.repeat(200),
      username: 'y'.repeat(200),
      avatar: square,
      background: await prepareBackground(createCanvas(2000, 300).toBuffer('image/png')),
      preset: 'ocean',
      accent: 0,
      rank: 123_456,
      level: 999,
      current: 50,
      needed: 100,
      labels,
    });
    expect(isPng(withImages)).toBe(true);
  });

  it('resizes uploaded backgrounds to card size', async () => {
    const { loadImage } = await import('@napi-rs/canvas');
    const prepared = await loadImage(await prepareBackground(createCanvas(400, 400).toBuffer('image/png')));
    expect([prepared.width, prepared.height]).toEqual([CARD_WIDTH, CARD_HEIGHT]);
  });

  it('rejects tiny images and non-images', async () => {
    await expect(prepareBackground(createCanvas(10, 10).toBuffer('image/png'))).rejects.toThrow();
    await expect(prepareBackground(Buffer.from('not an image'))).rejects.toThrow();
  });

  it('shortens big numbers', () => {
    expect([compact(999), compact(9_999), compact(12_345), compact(250_000), compact(1_500_000), compact(25_000_000)]).toEqual([
      '999',
      '9,999',
      '12.3K',
      '250K',
      '1.5M',
      '25M',
    ]);
  });
});
