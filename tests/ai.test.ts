import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildConversation, splitReply } from '../src/modules/ai/conversation.js';
import { AnthropicProvider } from '../src/modules/ai/providers/anthropic.js';
import { GeminiProvider } from '../src/modules/ai/providers/gemini.js';
import { configuredProviders, pickProvider } from '../src/modules/ai/providers/index.js';
import { OpenAIProvider } from '../src/modules/ai/providers/openai.js';
import { ProviderError, type ChatRequest } from '../src/modules/ai/providers/types.js';
import { RateLimiter } from '../src/core/rate-limit.js';
import { parseScanResult } from '../src/modules/ai/scan-result.js';
import { aiConfig } from '../src/modules/ai/settings.js';
import type { Env } from '../src/config/env.js';

describe('buildConversation', () => {
  it('prefixes user names and keeps the bot as the assistant', () => {
    expect(
      buildConversation([
        { authorName: 'Ana', content: 'hi', fromBot: false },
        { authorName: 'Bot', content: 'hello!', fromBot: true },
        { authorName: 'Ana', content: 'how are you?', fromBot: false },
      ]),
    ).toEqual([
      { role: 'user', content: 'Ana: hi' },
      { role: 'assistant', content: 'hello!' },
      { role: 'user', content: 'Ana: how are you?' },
    ]);
  });

  it('merges consecutive turns and trims bot turns at both ends', () => {
    const result = buildConversation([
      { authorName: 'Bot', content: 'old reply', fromBot: true },
      { authorName: 'Ana', content: 'one', fromBot: false },
      { authorName: 'Ben', content: 'two', fromBot: false },
      { authorName: 'Ana', content: '   ', fromBot: false },
      { authorName: 'Bot', content: 'trailing', fromBot: true },
    ]);
    expect(result).toEqual([{ role: 'user', content: 'Ana: one\nBen: two' }]);
  });
});

describe('splitReply', () => {
  it('leaves short replies alone', () => {
    expect(splitReply('hello')).toEqual(['hello']);
  });

  it('splits on line breaks within the limit', () => {
    const text = `${'a'.repeat(15)}\n${'b'.repeat(15)}\n${'c'.repeat(15)}`;
    const chunks = splitReply(text, 35);
    expect(chunks).toEqual([`${'a'.repeat(15)}\n${'b'.repeat(15)}`, 'c'.repeat(15)]);
  });

  it('hard-splits text without break points', () => {
    const chunks = splitReply('x'.repeat(50), 20);
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 10]);
  });
});

describe('parseScanResult', () => {
  it('reads plain and fenced JSON', () => {
    expect(parseScanResult('{"scam": 91, "reason": "Fake Nitro gift"}')).toEqual({ score: 91, reason: 'Fake Nitro gift' });
    expect(parseScanResult('Sure!\n```json\n{"scam": "12", "reason": "A meme"}\n```')).toEqual({ score: 12, reason: 'A meme' });
  });

  it('clamps scores and falls back to a loose match', () => {
    expect(parseScanResult('{"scam": 140}')?.score).toBe(100);
    expect(parseScanResult('scam: 75 because of the QR code')).toEqual({ score: 75, reason: '' });
  });

  it('returns null for answers without a score', () => {
    expect(parseScanResult('I cannot help with that.')).toBeNull();
  });
});

describe('RateLimiter', () => {
  it('allows up to the limit per window and per key', () => {
    let now = 0;
    const limiter = new RateLimiter(60_000, () => now);
    expect([1, 2, 3].map(() => limiter.take('a', 2))).toEqual([true, true, false]);
    expect(limiter.take('b', 2)).toBe(true);
    now = 60_001;
    expect(limiter.take('a', 2)).toBe(true);
  });
});

describe('providers', () => {
  const env = { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: 'sk-ant', GEMINI_API_KEY: '', AI_COMPAT_API_KEY: '' } as Env;

  it('only offers providers that are set up', () => {
    const config = aiConfig.parse({ providers: { compatible: { baseUrl: 'http://localhost:11434/v1', chatModel: 'llama3' } } });
    const available = configuredProviders(env, config);
    expect([...available.keys()].sort()).toEqual(['anthropic', 'compatible']);
    expect(pickProvider(available, 'openai', 'gemini')?.provider.name).toBe('anthropic');
    expect(pickProvider(available, 'compatible', 'anthropic')?.provider.name).toBe('compatible');
    expect(pickProvider(new Map(), null, 'anthropic')).toBeNull();
  });
});

describe('provider requests', () => {
  const request: ChatRequest = {
    model: 'm',
    system: 'be nice',
    maxTokens: 100,
    messages: [{ role: 'user', content: 'what is this?', images: [{ mimeType: 'image/webp', data: 'AAAA' }] }],
  };
  const fetchMock = vi.fn();
  const signal = new AbortController().signal;
  vi.stubGlobal('fetch', fetchMock);
  afterEach(() => fetchMock.mockReset());

  const respond = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
  };

  it('OpenAI: system message, image parts and max_completion_tokens', async () => {
    respond({ choices: [{ message: { content: 'a cat' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
    const result = await new OpenAIProvider('openai', 'https://api.openai.com/v1', 'sk').chat(request, signal);
    const { url, headers, body } = sent();
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(headers.authorization).toBe('Bearer sk');
    expect(body.max_completion_tokens).toBe(100);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be nice' });
    expect(body.messages[1].content[1].image_url.url).toBe('data:image/webp;base64,AAAA');
    expect(result).toEqual({ text: 'a cat', inputTokens: 10, outputTokens: 2 });
  });

  it('compatible servers: max_tokens, no auth header without a key, trailing slash tolerated', async () => {
    respond({ choices: [{ message: { content: 'ok' } }] });
    await new OpenAIProvider('compatible', 'http://localhost:11434/v1/', '').chat(request, signal);
    const { url, headers, body } = sent();
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(headers.authorization).toBeUndefined();
    expect(body.max_tokens).toBe(100);
  });

  it('Anthropic: top-level system and base64 image blocks', async () => {
    respond({ content: [{ type: 'text', text: 'a dog' }], usage: { input_tokens: 20, output_tokens: 3 } });
    const result = await new AnthropicProvider('sk-ant').chat(request, signal);
    const { url, headers, body } = sent();
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers['x-api-key']).toBe('sk-ant');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(body.system).toBe('be nice');
    expect(body.max_tokens).toBe(100);
    expect(body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/webp', data: 'AAAA' } });
    expect(result.text).toBe('a dog');
  });

  it('Gemini: model role mapping, inline data and thinking tokens counted', async () => {
    respond({
      candidates: [{ content: { parts: [{ text: 'a bird' }] } }],
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 4, thoughtsTokenCount: 6 },
    });
    const result = await new GeminiProvider('g').chat(
      { ...request, messages: [...request.messages, { role: 'assistant', content: 'hm' }, { role: 'user', content: 'and?' }] },
      signal,
    );
    const { url, headers, body } = sent();
    expect(url).toContain('/models/m:generateContent');
    expect(headers['x-goog-api-key']).toBe('g');
    expect(body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/webp', data: 'AAAA' } });
    expect(body.contents[1].role).toBe('model');
    expect(result).toEqual({ text: 'a bird', inputTokens: 30, outputTokens: 10 });
  });

  it('maps HTTP failures to error kinds', async () => {
    const kind = async (status: number) => {
      respond({ error: 'nope' }, status);
      try {
        await new AnthropicProvider('k').chat(request, signal);
      } catch (err) {
        return (err as ProviderError).kind;
      }
      return 'none';
    };
    expect(await kind(401)).toBe('auth');
    expect(await kind(429)).toBe('rate_limit');
    expect(await kind(400)).toBe('bad_request');
    expect(await kind(529)).toBe('unavailable');
  });

  it('treats an empty answer as an error', async () => {
    respond({ candidates: [{ finishReason: 'SAFETY' }] });
    await expect(new GeminiProvider('g').chat(request, signal)).rejects.toMatchObject({ kind: 'empty' });
  });
});
