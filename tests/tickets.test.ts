import { Collection, type GuildTextBasedChannel, type Message } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { collectMessages } from '../src/modules/tickets/collect.js';
import { channelName } from '../src/modules/tickets/naming.js';

describe('channelName', () => {
  it('fills the pattern and pads the number', () => {
    expect(channelName('ticket-{number}', { number: 42, user: 'Ana', category: 'Support' })).toBe('ticket-0042');
    expect(channelName('{category}-{user}', { number: 1, user: 'Ana.Bé', category: 'Bug Reports!' })).toBe('bug-reports-ana-be');
  });

  it('falls back to safe names for unusual usernames', () => {
    expect(channelName('help-{user}', { number: 7, user: '★★★', category: 'x' })).toBe('help-user');
    expect(channelName('***', { number: 7, user: 'a', category: 'x' })).toBe('ticket-7');
  });

  it('respects the channel name length limit', () => {
    expect(channelName('{user}', { number: 1, user: 'a'.repeat(300), category: 'x' }).length).toBe(100);
  });
});

function fakeMessage(id: number, extra: Partial<Record<string, unknown>> = {}): Message {
  return {
    id: String(id),
    cleanContent: `message ${id}`,
    member: { displayName: 'Ana', displayColor: 0, displayHexColor: '#000000' },
    author: { displayName: 'ana', bot: false, displayAvatarURL: () => 'https://cdn.discordapp.com/a.png' },
    createdAt: new Date(id * 1000),
    editedTimestamp: null,
    attachments: new Collection(),
    embeds: [],
    components: [],
    ...extra,
  } as unknown as Message;
}

describe('collectMessages', () => {
  it('pages backwards and returns messages oldest first', async () => {
    const all = Array.from({ length: 250 }, (_, i) => fakeMessage(i + 1));
    const fetch = vi.fn(async ({ before }: { before?: string }) => {
      const end = before ? Number(before) - 1 : all.length;
      const page = all.slice(Math.max(0, end - 100), end).reverse();
      return new Collection(page.map((m) => [m.id, m]));
    });
    const channel = { messages: { fetch } } as unknown as GuildTextBasedChannel;

    const result = await collectMessages(channel, 1000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(250);
    expect(result[0]!.id).toBe('1');
    expect(result.at(-1)!.id).toBe('250');
  });

  it('stops at the limit and keeps the newest messages', async () => {
    const all = Array.from({ length: 150 }, (_, i) => fakeMessage(i + 1));
    const fetch = vi.fn(async ({ before }: { before?: string }) => {
      const end = before ? Number(before) - 1 : all.length;
      return new Collection(all.slice(Math.max(0, end - 100), end).reverse().map((m) => [m.id, m]));
    });
    const result = await collectMessages({ messages: { fetch } } as unknown as GuildTextBasedChannel, 120);
    expect(result).toHaveLength(120);
    expect(result.at(-1)!.id).toBe('150');
  });

  it('reads the text out of Components V2 messages', async () => {
    const v2 = fakeMessage(1, {
      cleanContent: '',
      components: [{ toJSON: () => ({ type: 17, components: [{ type: 10, content: '## Ticket #0001' }, { type: 10, content: 'Welcome' }] }) }],
    });
    const fetch = vi.fn(async () => new Collection([[v2.id, v2]]));
    const [result] = await collectMessages({ messages: { fetch } } as unknown as GuildTextBasedChannel, 10);
    expect(result!.content).toBe('## Ticket #0001\nWelcome');
  });
});
