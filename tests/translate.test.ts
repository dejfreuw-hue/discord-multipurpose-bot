import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bot } from '../src/core/bot.js';
import { isLanguage, languageFromLocale, languageName } from '../src/modules/translate/languages.js';
import { deepl, libreTranslate, pickTranslator } from '../src/modules/translate/services.js';

function mockFetch(body: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('languages', () => {
  it('maps Discord locales to translation targets', () => {
    expect(languageFromLocale('pt-BR')).toBe('pt');
    expect(languageFromLocale('en-GB')).toBe('en');
    expect(languageFromLocale('zh-TW')).toBe('zh');
    expect(languageFromLocale('no')).toBe('nb');
    expect(languageFromLocale('tlh')).toBe('en');
  });

  it('names languages in the reader language', () => {
    expect(languageName('de', 'en')).toBe('German');
    expect(languageName('de', 'de')).toBe('Deutsch');
    expect(isLanguage('xx')).toBe(false);
  });
});

describe('deepl', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the free host for free keys and a regional English target', async () => {
    const fetch = mockFetch({ translations: [{ detected_source_language: 'DE', text: 'Hello' }] });
    const result = await deepl('abc:fx').translate('Hallo', 'en', null);
    expect(result).toEqual({ text: 'Hello', detected: 'de' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api-free.deepl.com/v2/translate');
    expect(JSON.parse(String(init!.body))).toEqual({ text: ['Hallo'], target_lang: 'EN-US' });
    expect((init!.headers as Record<string, string>).authorization).toBe('DeepL-Auth-Key abc:fx');
  });

  it('uses the paid host and passes a source language', async () => {
    const fetch = mockFetch({ translations: [{ text: 'Hola' }] });
    await deepl('paid').translate('Hello', 'es', 'en');
    expect(fetch.mock.calls[0]![0]).toBe('https://api.deepl.com/v2/translate');
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toMatchObject({ target_lang: 'ES', source_lang: 'EN' });
  });
});

describe('libreTranslate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('auto-detects the source and reads the detected language', async () => {
    const fetch = mockFetch({ translatedText: 'Bonjour', detectedLanguage: { confidence: 90, language: 'en' } });
    const result = await libreTranslate('https://translate.example.com/', '').translate('Hello', 'fr', null);
    expect(result).toEqual({ text: 'Bonjour', detected: 'en' });
    expect(fetch.mock.calls[0]![0]).toBe('https://translate.example.com/translate');
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toEqual({ q: 'Hello', source: 'auto', target: 'fr', format: 'text' });
  });
});

describe('pickTranslator', () => {
  const bot = (env: Record<string, string>, aiEnabled = false) =>
    ({ env: { DEEPL_API_KEY: '', LIBRETRANSLATE_API_KEY: '', ...env }, isEnabled: () => aiEnabled }) as unknown as Bot;

  it('prefers DeepL, then LibreTranslate', () => {
    expect(pickTranslator(bot({ DEEPL_API_KEY: 'k' }), 'auto', 'https://lt.example.com')?.label).toBe('DeepL');
    expect(pickTranslator(bot({}), 'auto', 'https://lt.example.com')?.label).toBe('LibreTranslate');
  });

  it('returns null when nothing is set up', () => {
    expect(pickTranslator(bot({}), 'auto', '')).toBeNull();
    expect(pickTranslator(bot({}), 'deepl', 'https://lt.example.com')).toBeNull();
  });
});
