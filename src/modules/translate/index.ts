import { SlashCommandBuilder, type AutocompleteInteraction } from 'discord.js';
import { z } from 'zod';
import type { InteractionContext } from '../../core/context.js';
import { UserError } from '../../core/errors.js';
import { defineCommand, defineContextMenu, defineModule } from '../../core/module.js';
import { RateLimiter } from '../../core/rate-limit.js';
import { isLanguage, LANGUAGES, languageFromLocale, languageName, type Language } from './languages.js';
import { pickTranslator } from './services.js';

const translateConfig = z.object({
  /** auto uses DeepL if DEEPL_API_KEY is set, then LibreTranslate if a URL is set, then the AI module. */
  service: z.enum(['auto', 'deepl', 'libretranslate', 'ai']).default('auto'),
  libretranslateUrl: z.union([z.url(), z.literal('')]).default(''),
  perUserPerMinute: z.number().int().min(1).max(60).default(6),
  maxLength: z.number().int().min(100).max(5000).default(2000),
});

const limiter = new RateLimiter(60_000);
// Leaves room in the panel for the footer.
const MAX_OUTPUT = 3800;

function config(ctx: InteractionContext) {
  return ctx.bot.moduleConfig({ name: 'translate', config: translateConfig });
}

async function languageAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const typed = interaction.options.getFocused().toLowerCase();
  const choices = LANGUAGES.map((code) => ({ name: `${languageName(code, interaction.locale)} (${code})`, value: code }))
    .filter((c) => !typed || c.name.toLowerCase().includes(typed))
    .sort((a, b) => a.name.localeCompare(b.name, interaction.locale));
  await interaction.respond(choices.slice(0, 25));
}

async function translateAndReply(ctx: InteractionContext, text: string, target: Language, source: Language | null): Promise<void> {
  const { service, libretranslateUrl, perUserPerMinute, maxLength } = config(ctx);
  if (!text.trim()) throw new UserError('translate.errors.empty');
  if (text.length > maxLength) throw new UserError('translate.errors.tooLong', { max: maxLength });
  const translator = pickTranslator(ctx.bot, service, libretranslateUrl);
  if (!translator) throw new UserError('translate.errors.notSetUp');
  if (!limiter.take(ctx.interaction.user.id, perUserPerMinute)) throw new UserError('translate.errors.rateLimited');

  const result = await translator.translate(text, target, source);
  const from = source ?? result.detected;
  const footer = from
    ? ctx.t('translate.footerFrom', { from: languageName(from, ctx.locale), to: languageName(target, ctx.locale), service: translator.label })
    : ctx.t('translate.footer', { to: languageName(target, ctx.locale), service: translator.label });
  const output = result.text.length > MAX_OUTPUT ? `${result.text.slice(0, MAX_OUTPUT)}...` : result.text;
  await ctx.respond(ctx.panel().text(output).footer(footer));
}

function languageOption(ctx: InteractionContext, name: string): Language | null {
  const value = (ctx.interaction.isChatInputCommand() && ctx.interaction.options.getString(name)) || null;
  if (value === null) return null;
  if (!isLanguage(value)) throw new UserError('translate.errors.language', { value: value.slice(0, 20) });
  return value;
}

const translate = defineCommand({
  scope: 'anywhere',
  data: new SlashCommandBuilder()
    .setName('translate')
    .setDescription('translate.command.description')
    .addStringOption((o) => o.setName('text').setDescription('translate.command.options.text').setRequired(true).setMaxLength(5000))
    .addStringOption((o) => o.setName('to').setDescription('translate.command.options.to').setAutocomplete(true))
    .addStringOption((o) => o.setName('from').setDescription('translate.command.options.from').setAutocomplete(true)),
  defer: 'public',
  autocomplete: languageAutocomplete,
  async run(ctx) {
    const target = languageOption(ctx, 'to') ?? languageFromLocale(ctx.interaction.locale);
    await translateAndReply(ctx, ctx.interaction.options.getString('text', true), target, languageOption(ctx, 'from'));
  },
});

const translateMessage = defineContextMenu({
  type: 'message',
  name: 'translate.menu',
  scope: 'anywhere',
  defer: 'ephemeral',
  async run(ctx) {
    const message = ctx.interaction.targetMessage;
    // Bots often put everything in embeds; translate those when there's no plain text.
    const text = message.content || message.embeds.map((e) => [e.title, e.description].filter(Boolean).join('\n')).join('\n\n');
    await translateAndReply(ctx, text, languageFromLocale(ctx.interaction.locale), null);
  },
});

export default defineModule({
  name: 'translate',
  toggleable: true,
  config: translateConfig,
  commands: [translate],
  contextMenus: [translateMessage],
});
