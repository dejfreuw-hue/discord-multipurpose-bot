/** Target languages offered in /translate. Every service here supports these. */
export const LANGUAGES = [
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'he', 'hi', 'hu', 'id', 'it', 'ja',
  'ko', 'lt', 'lv', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
] as const;

export type Language = (typeof LANGUAGES)[number];

export function isLanguage(code: string): code is Language {
  return (LANGUAGES as readonly string[]).includes(code);
}

/** The language part of a Discord locale ("pt-BR" -> "pt"); Norwegian is "no" on Discord. */
export function languageFromLocale(locale: string): Language {
  const base = locale.split('-')[0]!.toLowerCase();
  const code = base === 'no' ? 'nb' : base;
  return isLanguage(code) ? code : 'en';
}

/** A language's name in the reader's own language, e.g. "German" or "Deutsch". */
export function languageName(code: string, displayLocale: string): string {
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
