import type { Env } from '../../../config/env.js';
import type { AiConfig } from '../settings.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import { PROVIDERS, type Provider, type ProviderName } from './types.js';

export interface ConfiguredProvider {
  provider: Provider;
  chatModel: string;
  visionModel: string;
}

/** Providers the bot owner has set up: an API key in .env (or a base URL for compatible servers) plus models. */
export function configuredProviders(env: Env, config: AiConfig): Map<ProviderName, ConfiguredProvider> {
  const out = new Map<ProviderName, ConfiguredProvider>();
  const { openai, anthropic, gemini, compatible } = config.providers;
  if (env.OPENAI_API_KEY) out.set('openai', { provider: new OpenAIProvider('openai', 'https://api.openai.com/v1', env.OPENAI_API_KEY), ...openai });
  if (env.ANTHROPIC_API_KEY) out.set('anthropic', { provider: new AnthropicProvider(env.ANTHROPIC_API_KEY), ...anthropic });
  if (env.GEMINI_API_KEY) out.set('gemini', { provider: new GeminiProvider(env.GEMINI_API_KEY), ...gemini });
  if (compatible.baseUrl && compatible.chatModel) {
    out.set('compatible', {
      provider: new OpenAIProvider('compatible', compatible.baseUrl, env.AI_COMPAT_API_KEY),
      chatModel: compatible.chatModel,
      visionModel: compatible.visionModel,
    });
  }
  return out;
}

/** The server's chosen provider if it's available, else the default, else the first one set up. */
export function pickProvider(
  available: ReadonlyMap<ProviderName, ConfiguredProvider>,
  preferred: ProviderName | null,
  fallback: ProviderName,
): ConfiguredProvider | null {
  for (const name of [preferred, fallback, ...PROVIDERS]) {
    if (name && available.has(name)) return available.get(name)!;
  }
  return null;
}
