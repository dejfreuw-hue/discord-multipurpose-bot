import type { Guild, GuildMember } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { UserError } from '../../core/errors.js';
import { PERSONALITIES } from './personalities.js';
import { configuredProviders, pickProvider, type ConfiguredProvider } from './providers/index.js';
import { ProviderError, type ChatMessage, type ProviderName } from './providers/types.js';
import { RateLimiter } from './rate-limit.js';
import { aiConfig, type AiSettings } from './settings.js';
import { recordUsage, usage } from './usage.js';

export const userLimiter = new RateLimiter(60_000);

let providers: Map<ProviderName, ConfiguredProvider> | undefined;

/** Built once from .env and config.yml; both only change on restart. */
export function availableProviders(bot: Bot): Map<ProviderName, ConfiguredProvider> {
  providers ??= configuredProviders(bot.env, bot.moduleConfig({ name: 'ai', config: aiConfig }));
  return providers;
}

export function providerFor(bot: Bot, settings: AiSettings): ConfiguredProvider {
  const config = bot.moduleConfig({ name: 'ai', config: aiConfig });
  const chosen = pickProvider(availableProviders(bot), settings.provider, config.defaultProvider);
  if (!chosen) throw new UserError('ai.errors.noProvider');
  return chosen;
}

export function isBlacklisted(member: GuildMember, settings: AiSettings): boolean {
  return settings.blacklist.includes(member.id) || member.roles.cache.some((r) => settings.blacklist.includes(r.id));
}

export function personaFor(settings: AiSettings): string {
  if (settings.personality === 'custom' && settings.customPrompt) return settings.customPrompt;
  return PERSONALITIES[settings.personality] ?? PERSONALITIES.helpful!;
}

/** Throws a UserError when the user is rate limited or the server has used up today's tokens. */
export async function checkLimits(bot: Bot, guild: Guild, userId: string, settings: AiSettings): Promise<void> {
  if (!userLimiter.take(`${guild.id}:${userId}`, settings.userPerMinute)) throw new UserError('ai.errors.rateLimited');
  const cap = Math.min(settings.dailyTokens, bot.moduleConfig({ name: 'ai', config: aiConfig }).maxDailyTokens);
  if ((await usage(guild.id)).tokens >= cap) throw new UserError('ai.errors.budget');
}

/** Sends one request and records its token use against the guild's daily budget. */
export async function complete(
  bot: Bot,
  guild: Guild,
  configured: ConfiguredProvider,
  request: { system: string; messages: ChatMessage[]; vision?: boolean; maxTokens?: number },
): Promise<string> {
  const config = bot.moduleConfig({ name: 'ai', config: aiConfig });
  const model = request.vision ? configured.visionModel : configured.chatModel;
  if (!model) throw new UserError('ai.errors.noVisionModel');

  try {
    const result = await configured.provider.chat(
      { model, system: request.system, messages: request.messages, maxTokens: request.maxTokens ?? config.maxOutputTokens },
      AbortSignal.timeout(config.timeoutSeconds * 1000),
    );
    await recordUsage(guild.id, result.inputTokens + result.outputTokens);
    return result.text;
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    // Auth and bad requests are setup problems the owner has to fix, so they're worth a warning.
    const level = err.kind === 'auth' || err.kind === 'bad_request' ? 'warn' : 'info';
    bot.logger[level]({ provider: configured.provider.name, model, kind: err.kind, detail: err.message }, 'ai request failed');
    throw new UserError(`ai.errors.${err.kind}`);
  }
}
