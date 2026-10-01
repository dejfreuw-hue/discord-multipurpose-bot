import { describe, expect, it } from 'vitest';
import { escapeHtml, renderMarkdown, renderTranscript, type TranscriptMessage } from '../src/modules/tickets/transcript.js';

describe('renderMarkdown', () => {
  it('escapes HTML before anything else', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).not.toContain('<img');
  });

  it('formats Discord markdown', () => {
    expect(renderMarkdown('**bold** *it* __under__ ~~gone~~ ||secret||')).toBe(
      '<strong>bold</strong> <em>it</em> <u>under</u> <s>gone</s> <span class="spoiler">secret</span>',
    );
  });

  it('leaves code untouched', () => {
    expect(renderMarkdown('`**not bold**`')).toBe('<code>**not bold**</code>');
    expect(renderMarkdown('```js\nconst a = "<b>";\n```')).toBe('<pre><code>const a = &quot;&lt;b&gt;&quot;;\n</code></pre>');
  });

  it('links only http(s) URLs and keeps query strings intact', () => {
    const html = renderMarkdown('see https://example.com/a?b=1&c=2.');
    expect(html).toContain('href="https://example.com/a?b=1&amp;c=2"');
    expect(html.endsWith('.')).toBe(true);
    expect(renderMarkdown('javascript:alert(1)')).not.toContain('href');
  });

  it('renders quotes, line breaks and custom emojis', () => {
    expect(renderMarkdown('> quoted\nplain')).toBe('<blockquote>quoted</blockquote>plain');
    expect(renderMarkdown('<:wave:123456789012345678>')).toContain('src="https://cdn.discordapp.com/emojis/123456789012345678.webp?size=48"');
  });
});

describe('renderTranscript', () => {
  const base: Omit<TranscriptMessage, 'id' | 'content'> = {
    authorName: 'Ana "<x>"',
    authorAvatar: 'https://cdn.discordapp.com/avatars/1/a.png',
    authorColor: '#ff0000',
    bot: false,
    timestamp: new Date('2026-01-01T10:00:00Z'),
    edited: false,
    attachments: [],
    embeds: [],
  };

  it('builds a complete page with escaped metadata and grouped messages', () => {
    const html = renderTranscript(
      {
        title: 'Ticket #0001',
        guildName: 'My <Server>',
        guildIcon: null,
        channelName: 'ticket-0001',
        details: [['Opened by', 'Ana']],
        generatedAt: new Date('2026-01-01T12:00:00Z'),
      },
      [
        { ...base, id: '1', content: 'hello' },
        { ...base, id: '2', content: 'again', timestamp: new Date('2026-01-01T10:01:00Z') },
        {
          ...base,
          id: '3',
          content: '',
          timestamp: new Date('2026-01-01T11:00:00Z'),
          attachments: [{ name: 'log.txt', url: 'https://cdn.discordapp.com/x/log.txt', size: 2048, image: false }],
        },
      ],
    );
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('My &lt;Server&gt;');
    expect(html).toContain('Ana &quot;&lt;x&gt;&quot;');
    expect(html).toContain('class="message grouped" id="m2"');
    expect(html).toContain('class="message" id="m3"');
    expect(html).toContain('log.txt <span>2.0 KB</span>');
    expect(html).toContain('3 messages');
  });

  it('drops attachments with unsafe URLs and invalid colours', () => {
    const html = renderTranscript(
      { title: 't', guildName: 'g', guildIcon: 'javascript:alert(1)', channelName: 'c', details: [], generatedAt: new Date() },
      [
        {
          ...base,
          id: '1',
          content: 'x',
          authorColor: 'red;background:url(x)',
          attachments: [{ name: 'a', url: 'javascript:alert(1)', size: 1, image: true }],
        },
      ],
    );
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('url(x)');
  });
});

describe('escapeHtml', () => {
  it('escapes quotes for attributes', () => {
    expect(escapeHtml(`"'&<>`)).toBe('&quot;&#39;&amp;&lt;&gt;');
  });
});

describe('renderMarkdown links', () => {
  it('does not apply formatting inside URLs', () => {
    const html = renderMarkdown('https://example.com/a_b_c/**x**');
    expect(html).toContain('href="https://example.com/a_b_c/**x**"');
    expect(html).not.toContain('<em>');
  });
});
