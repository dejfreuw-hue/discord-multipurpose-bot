import { describe, expect, it } from 'vitest';
import { canClaim, canManage, channelName, RENAME_WINDOW_MS, renameWait } from '../src/modules/voice/rules.js';

describe('channelName', () => {
  it('fills the template', () => {
    expect(channelName("{user}'s channel", { user: 'Ana' })).toBe("Ana's channel");
    expect(channelName('{game} | {user}', { user: 'Ana', game: 'Minecraft' })).toBe('Minecraft | Ana');
    expect(channelName('Room #{count}', { user: 'Ana', count: 3 })).toBe('Room #3');
  });

  it('uses the user when there is no game and falls back on empty names', () => {
    expect(channelName('{game}', { user: 'Ana', game: null })).toBe('Ana');
    expect(channelName('   ', { user: 'Ana' })).toBe('Ana');
  });

  it('collapses whitespace and respects the length limit', () => {
    expect(channelName('a   b', { user: 'x' })).toBe('a b');
    expect(channelName('{user}', { user: 'x'.repeat(150) })).toHaveLength(100);
  });
});

describe('renameWait', () => {
  it('allows two renames per window', () => {
    expect(renameWait([], 1000)).toBe(0);
    expect(renameWait([1000], 2000)).toBe(0);
    expect(renameWait([1000, 2000], 3000)).toBe(1000 + RENAME_WINDOW_MS - 3000);
  });

  it('ignores renames outside the window', () => {
    expect(renameWait([0, 1000], RENAME_WINDOW_MS + 1001)).toBe(0);
  });

  it('waits for the older of the last two renames to expire', () => {
    expect(renameWait([0, 100, 200], 300)).toBe(100 + RENAME_WINDOW_MS - 300);
  });
});

describe('permissions', () => {
  it('lets owners and staff manage a channel', () => {
    expect(canManage({ isOwner: true, isStaff: false })).toBe(true);
    expect(canManage({ isOwner: false, isStaff: true })).toBe(true);
    expect(canManage({ isOwner: false, isStaff: false })).toBe(false);
  });

  it('allows claiming only from inside a channel the owner left', () => {
    expect(canClaim(false, true)).toBe(true);
    expect(canClaim(true, true)).toBe(false);
    expect(canClaim(false, false)).toBe(false);
  });
});
