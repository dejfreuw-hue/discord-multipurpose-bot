import { describe, expect, it } from 'vitest';
import { renderWelcomeCard } from '../src/modules/community/welcome/card.js';
import { fillTemplate } from '../src/modules/community/welcome/message.js';

describe('fillTemplate', () => {
  it('replaces every placeholder, as often as it appears', () => {
    const vars = { user: '<@1>', username: 'Ana', server: 'Cafe', count: 1234 };
    expect(fillTemplate('Hi {user} ({username})! {server} has {count} members. Bye {username}', vars)).toBe(
      'Hi <@1> (Ana)! Cafe has 1,234 members. Bye Ana',
    );
  });

  it('leaves unknown placeholders alone', () => {
    expect(fillTemplate('{nope}', { user: '', username: '', server: '', count: 0 })).toBe('{nope}');
  });
});

describe('renderWelcomeCard', () => {
  it('renders a PNG without an avatar or background', async () => {
    const png = await renderWelcomeCard({ title: 'WELCOME', name: 'x'.repeat(200), subtitle: 'Member #1', avatar: null, background: null, preset: 'nope', accent: 0 });
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });
});
