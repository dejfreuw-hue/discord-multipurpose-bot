import { describe, expect, it } from 'vitest';
import { emojiKey } from '../src/core/emoji.js';
import { selectRoles, toggleRoles } from '../src/modules/community/roles/logic.js';

describe('emojiKey', () => {
  it('uses the id for custom emojis and the text for unicode ones', () => {
    expect(emojiKey('<:pepe:123456789012345678>')).toBe('123456789012345678');
    expect(emojiKey('<a:dance:123456789012345678>')).toBe('123456789012345678');
    expect(emojiKey(' \u2B50 ')).toBe('\u2B50');
  });
});

describe('toggleRoles', () => {
  const menu = ['red', 'blue', 'green'];

  it('adds a role the member lacks and removes one they have', () => {
    expect(toggleRoles(new Set(), menu, 'red', false)).toEqual({ add: ['red'], remove: [] });
    expect(toggleRoles(new Set(['red']), menu, 'red', false)).toEqual({ add: [], remove: ['red'] });
  });

  it('swaps out the other menu roles in exclusive menus', () => {
    expect(toggleRoles(new Set(['red', 'other']), menu, 'blue', true)).toEqual({ add: ['blue'], remove: ['red'] });
    expect(toggleRoles(new Set(['red']), menu, 'blue', false)).toEqual({ add: ['blue'], remove: [] });
  });
});

describe('selectRoles', () => {
  const menu = ['red', 'blue', 'green'];

  it('makes the member hold exactly the picked menu roles', () => {
    expect(selectRoles(new Set(['red', 'other']), menu, ['blue', 'green'])).toEqual({ add: ['blue', 'green'], remove: ['red'] });
  });

  it('ignores roles that are not part of the menu', () => {
    expect(selectRoles(new Set(), menu, ['admin'])).toEqual({ add: [], remove: [] });
  });

  it('removes everything when nothing is picked', () => {
    expect(selectRoles(new Set(['red', 'blue']), menu, [])).toEqual({ add: [], remove: ['red', 'blue'] });
  });
});
