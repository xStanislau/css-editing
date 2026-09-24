import type { KeyValueStore } from '../engine/progress';

export const LOCALES = ['en', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_STORAGE_KEY = 'vesper:locale';

const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

/** First-visit default: Russian when the browser's most preferred language is Russian, otherwise English. */
export function detectLocale(preferred: readonly string[]): Locale {
  return preferred[0]?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
}

/** An explicit, remembered choice wins; anything unreadable or invalid falls back to detection. */
export function loadLocale(store: KeyValueStore | null, preferred: readonly string[]): Locale {
  try {
    const saved = store?.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // Storage unavailable: fall through to detection.
  }
  return detectLocale(preferred);
}

export function saveLocale(store: KeyValueStore | null, locale: Locale): void {
  try {
    store?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Choice just won't persist; the switch still works for this visit.
  }
}
