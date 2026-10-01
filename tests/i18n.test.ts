import { describe, expect, it, vi } from 'vitest';
import { I18n } from '../src/core/i18n.js';
import { fromRoot } from '../src/core/paths.js';

function sample(): I18n {
  const i18n = new I18n('en');
  i18n.add('en', {
    _meta: { name: 'English', discord: ['en-US', 'en-GB'] },
    greet: 'Hello {name}',
    items_one: '{count} item',
    items_other: '{count} items',
    only: { english: 'only here' },
  });
  i18n.add('de', { _meta: { name: 'Deutsch', discord: ['de'] }, greet: 'Hallo {name}' });
  return i18n;
}

describe('I18n', () => {
  it('interpolates and falls back to the default locale', () => {
    const i18n = sample();
    expect(i18n.t('de', 'greet', { name: 'Ana' })).toBe('Hallo Ana');
    expect(i18n.t('de', 'only.english')).toBe('only here');
    expect(i18n.t('fr', 'greet', { name: 'Ana' })).toBe('Hello Ana');
  });

  it('picks plural forms by count', () => {
    const i18n = sample();
    expect(i18n.t('en', 'items', { count: 1 })).toBe('1 item');
    expect(i18n.t('en', 'items', { count: 4 })).toBe('4 items');
  });

  it('returns the key and reports it once when missing', () => {
    const onMissing = vi.fn();
    const i18n = new I18n('en', onMissing);
    i18n.add('en', {});
    expect(i18n.t('en', 'nope')).toBe('nope');
    i18n.t('en', 'nope');
    expect(onMissing).toHaveBeenCalledTimes(1);
  });

  it('maps Discord locales to files', () => {
    const i18n = sample();
    expect(i18n.fromDiscord('en-GB')).toBe('en');
    expect(i18n.fromDiscord('de')).toBe('de');
    expect(i18n.fromDiscord('ja')).toBeUndefined();
  });

  it('builds Discord localizations without the fallback locale', () => {
    expect(sample().localizations('greet')).toEqual({ de: 'Hallo {name}' });
  });

  it('loads the shipped locale files', () => {
    const i18n = I18n.fromDirectory(fromRoot('locales'), 'en');
    expect(i18n.has('en')).toBe(true);
    expect(i18n.hasKey('errors.generic')).toBe(true);
  });
});
