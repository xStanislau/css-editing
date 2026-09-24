import { describe, expect, it } from 'vitest';
import { case01, case01Rules, case01Text } from '../cases/case01';
import { caseTextProblems } from '../engine/buildCase';
import { evaluateDeduction } from '../engine/logic';
import { loadProgress, newProgress, saveProgress, storageKey, type KeyValueStore } from '../engine/progress';
import { reduce } from '../engine/reducer';
import type { CaseData } from '../engine/types';
import { detectLocale, loadLocale, LOCALE_STORAGE_KEY, LOCALES, saveLocale } from './locale';
import { uiStrings } from './ui';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

/** Structural fingerprint: key paths plus array lengths, with leaf values replaced by their type. */
function shape(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shape);
  if (typeof v === 'object' && v !== null)
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape((v as Record<string, unknown>)[k])]));
  return typeof v;
}

function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (typeof v === 'object' && v !== null) return Object.values(v).flatMap(strings);
  return [];
}

/** The rules a player is judged by, stripped of all text. */
const rulesOf = (c: CaseData) => ({
  id: c.id,
  evidence: c.evidence.map((e) => e.id),
  claims: c.suspects.map((s) => [s.id, s.claims.map((cl) => cl.id)]),
  contradictions: c.contradictions.map((x) => [x.claimId, x.evidenceId]),
  hints: c.hints.length,
  deduction: c.deduction.map((q) => [q.id, q.options.map((o) => o.id), q.correctOptionId]),
});

describe('translation parity', () => {
  it('UI strings have identical keys and non-empty values in every language', () => {
    expect(shape(uiStrings.ru)).toEqual(shape(uiStrings.en));
    for (const locale of LOCALES) for (const s of strings(uiStrings[locale])) expect(s.trim()).not.toBe('');
  });

  it('case text is complete and structurally identical in every language', () => {
    for (const locale of LOCALES) expect(caseTextProblems(case01Rules, case01Text[locale])).toEqual([]);
    // Same keys and same number of paragraphs / document lines everywhere.
    expect(shape(case01Text.ru)).toEqual(shape(case01Text.en));
  });

  it('Russian case text contains no untranslated Latin text', () => {
    const latin = strings(case01Text.ru).filter((s) => /[A-Za-z]/.test(s));
    expect(latin).toEqual([]);
  });

  it('every language plays by exactly the same rules', () => {
    expect(rulesOf(case01.ru)).toEqual(rulesOf(case01.en));
  });

  it('Russian documents keep every number, with times converted to the 24-hour clock', () => {
    // English documents use night-time 12-hour times (11:33 = 23:33, 12:30 = 00:30).
    const to24 = (t: string) => t.replace(/^(\d{1,2}):(\d\d)$/, (_m, h, mm) => `${h === '12' ? '00' : Number(h) + 12}:${mm}`);
    const numbers = (lines: string[], convert: boolean) =>
      lines.join(' ').match(/\d{1,2}:\d\d|\d+/g)!.map((n) => (convert && n.includes(':') ? to24(n) : n));
    for (const id of case01Rules.evidenceIds) {
      const en = case01Text.en.evidence[id].body;
      const ru = case01Text.ru.evidence[id].body;
      if (!/\d/.test(en.join(''))) continue;
      expect(numbers(ru, false), id).toEqual(numbers(en, true));
    }
  });
});

describe('language choice', () => {
  it('defaults to Russian only when the most preferred browser language is Russian', () => {
    expect(detectLocale(['ru-RU', 'en'])).toBe('ru');
    expect(detectLocale(['ru'])).toBe('ru');
    expect(detectLocale(['en-GB', 'ru'])).toBe('en');
    expect(detectLocale(['uk'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });

  it('remembers an explicit choice over the browser language, and ignores junk', () => {
    const store = memoryStore();
    saveLocale(store, 'en');
    expect(loadLocale(store, ['ru-RU'])).toBe('en');
    saveLocale(store, 'ru');
    expect(loadLocale(store, ['en-US'])).toBe('ru');
    expect(loadLocale(memoryStore({ [LOCALE_STORAGE_KEY]: 'fr' }), ['ru'])).toBe('ru');
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
    };
    expect(loadLocale(broken, ['ru'])).toBe('ru');
    expect(() => saveLocale(broken, 'en')).not.toThrow();
  });

  it('Russian plural forms are grammatical', () => {
    const f = uiStrings.ru.deduction.unexamined;
    expect(f(1)).toBe('Осталась 1 неизученная улика.');
    expect(f(3)).toBe('Остались 3 неизученные улики.');
    expect(f(5)).toBe('Осталось 5 неизученных улик.');
    expect(uiStrings.en.deduction.unexamined(1)).toBe('You have 1 unexamined item of evidence.');
  });
});

describe('switching language mid-game', () => {
  it('preserves progress and gives the same verdict in either language', () => {
    const store = memoryStore();
    // Play partway in English and save, as the app does after every action.
    let s = newProgress(case01.en);
    for (const a of [
      { type: 'start' },
      { type: 'examine', evidenceId: 'shoes' },
      { type: 'revealHint' },
      { type: 'challenge', claimId: 'ruth-outside', evidenceId: 'shoes' },
      { type: 'answer', questionId: 'where', optionId: 'wine-store' },
    ] as const)
      s = reduce(case01.en, s, a);
    saveProgress(case01.en, s, store);

    // Switch to Russian: the same save is read through the Russian case.
    saveLocale(store, 'ru');
    const locale = loadLocale(store, ['en-US']);
    expect(locale).toBe('ru');
    let r = loadProgress(case01[locale], store);
    expect(r).toEqual(s);

    // Finish in Russian and switch back to English.
    r = reduce(case01.ru, r, { type: 'answer', questionId: 'who', optionId: 'ruth' });
    r = reduce(case01.ru, r, { type: 'answer', questionId: 'proof', optionId: 'shoes' });
    r = reduce(case01.ru, r, { type: 'submit' });
    saveProgress(case01.ru, r, store);
    const back = loadProgress(case01.en, store);
    expect(back).toEqual(r);
    expect(back.submitted).toBe(true);
    expect(evaluateDeduction(case01.en, back.answers)).toEqual(evaluateDeduction(case01.ru, back.answers));
    expect(evaluateDeduction(case01.ru, back.answers).correct).toBe(true);

    // A wrong answer is judged identically too.
    const wrong = { ...back.answers, who: 'felix' };
    expect(evaluateDeduction(case01.ru, wrong)).toEqual(evaluateDeduction(case01.en, wrong));
  });

  it('loads a save written by the English-only version unchanged in both languages', () => {
    // Exact format written by v0.1 (before localization).
    const legacy =
      '{"version":1,"caseId":"case-01-vesper","started":true,"examined":["note","shoes"],"hintsUsed":2,' +
      '"contradictionsFound":["ruth-outside|shoes"],"answers":{"where":"wine-store"},"submitted":false}';
    for (const locale of LOCALES) {
      const store = memoryStore({ [storageKey(case01[locale])]: legacy });
      expect(loadProgress(case01[locale], store)).toEqual({ ...JSON.parse(legacy) });
    }
  });
});
