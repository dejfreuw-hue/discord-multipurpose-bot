import type { Bot } from '../../core/bot.js';
import { fetchJson, HttpError } from '../../core/http.js';
import { availableProviders } from '../ai/engine.js';
import { aiConfig } from '../ai/settings.js';
import { ProviderError } from '../ai/providers/types.js';
import { languageName, type Language } from './languages.js';

export interface Translation {
  text: string;
  /** Lowercase code of the detected source language, when the service says. */
  detected: string | null;
}

export interface Translator {
  /** Shown under translations, since some services require attribution. */
  readonly label: string;
  translate(text: string, target: Language, source: Language | null): Promise<Translation>;
}

/** DeepL wants a regional variant for English and Portuguese targets. */
function deeplTarget(code: Language): string {
  if (code === 'en') return 'EN-US';
  if (code === 'pt') return 'PT-BR';
  return code.toUpperCase();
}

export function deepl(apiKey: string): Translator {
  // Free-plan keys end in ":fx" and live on a separate host.
  const host = apiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  return {
    label: 'DeepL',
    async translate(text, target, source) {
      const body = { text: [text], target_lang: deeplTarget(target), ...(source ? { source_lang: source.toUpperCase() } : {}) };
      const data = await fetchJson<{ translations: { text: string; detected_source_language?: string }[] }>(`${host}/v2/translate`, {
        headers: { authorization: `DeepL-Auth-Key ${apiKey}` },
        body,
      });
      const first = data.translations[0];
      if (!first) throw new HttpError(502, 'DeepL returned no translation');
      return { text: first.text, detected: first.detected_source_language?.toLowerCase() ?? null };
    },
  };
}

export function libreTranslate(baseUrl: string, apiKey: string): Translator {
  const url = `${baseUrl.replace(/\/+$/, '')}/translate`;
  return {
    label: 'LibreTranslate',
    async translate(text, target, source) {
      const data = await fetchJson<{ translatedText: string; detectedLanguage?: { language: string } }>(url, {
        body: { q: text, source: source ?? 'auto', target, format: 'text', ...(apiKey ? { api_key: apiKey } : {}) },
      });
      return { text: data.translatedText, detected: data.detectedLanguage?.language ?? null };
    },
  };
}

export function aiTranslator(bot: Bot): Translator | null {
  // The AI module's settings only exist when it's enabled in config.yml.
  if (!bot.isEnabled('ai')) return null;
  const config = bot.moduleConfig({ name: 'ai', config: aiConfig });
  const providers = availableProviders(bot);
  const configured = providers.get(config.defaultProvider) ?? [...providers.values()][0];
  if (!configured) return null;
  return {
    label: 'AI',
    async translate(text, target, source) {
      const to = languageName(target, 'en');
      const from = source ? ` from ${languageName(source, 'en')}` : '';
      const system =
        `Translate the user's message${from} into ${to}. Reply with the translation only: no quotes, notes or explanations. ` +
        'Keep formatting, emojis, mentions like <@123>, and links exactly as they are. If it is already in that language, return it unchanged.';
      try {
        const result = await configured.provider.chat(
          { model: configured.chatModel, system, messages: [{ role: 'user', content: text }], maxTokens: Math.min(4000, text.length * 2 + 200) },
          AbortSignal.timeout(config.timeoutSeconds * 1000),
        );
        return { text: result.text, detected: null };
      } catch (err) {
        // Report it like any other outside service so the router shows a friendly message.
        if (err instanceof ProviderError) throw new HttpError(err.kind === 'rate_limit' ? 429 : 502, `${configured.provider.name}: ${err.message}`);
        throw err;
      }
    },
  };
}

export type ServiceChoice = 'auto' | 'deepl' | 'libretranslate' | 'ai';

/** The translation service to use, or null when none is set up. `auto` takes the first one available. */
export function pickTranslator(bot: Bot, choice: ServiceChoice, libreUrl: string): Translator | null {
  const { DEEPL_API_KEY: deeplKey, LIBRETRANSLATE_API_KEY: libreKey } = bot.env;
  const options: Record<Exclude<ServiceChoice, 'auto'>, () => Translator | null> = {
    deepl: () => (deeplKey ? deepl(deeplKey) : null),
    libretranslate: () => (libreUrl ? libreTranslate(libreUrl, libreKey) : null),
    ai: () => aiTranslator(bot),
  };
  if (choice !== 'auto') return options[choice]();
  return options.deepl() ?? options.libretranslate() ?? options.ai();
}
