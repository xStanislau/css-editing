import type { CaseData } from './types';
import { contradictionKey, type DeductionAnswers } from './logic';

export const PROGRESS_VERSION = 1;

export interface Progress {
  version: typeof PROGRESS_VERSION;
  caseId: string;
  started: boolean;
  examined: string[];
  hintsUsed: number;
  /** Keys from contradictionKey(). */
  contradictionsFound: string[];
  answers: DeductionAnswers;
  submitted: boolean;
}

export function newProgress(caseData: CaseData): Progress {
  return {
    version: PROGRESS_VERSION,
    caseId: caseData.id,
    started: false,
    examined: [],
    hintsUsed: 0,
    contradictionsFound: [],
    answers: {},
    submitted: false,
  };
}

export function storageKey(caseData: CaseData): string {
  return `vesper:${caseData.id}:progress`;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const stringArray = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : null;

/**
 * Parse saved progress. Returns null for anything that is not trustworthy
 * (bad JSON, wrong version, other case, wrong types). Unknown ids are dropped
 * and numbers clamped so edited-but-plausible saves still load safely.
 */
export function parseProgress(raw: string | null, caseData: CaseData): Progress | null {
  if (raw === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  if (data.version !== PROGRESS_VERSION || data.caseId !== caseData.id) return null;

  const examined = stringArray(data.examined);
  const found = stringArray(data.contradictionsFound);
  if (typeof data.started !== 'boolean' || typeof data.submitted !== 'boolean') return null;
  if (examined === null || found === null) return null;
  if (typeof data.hintsUsed !== 'number' || !Number.isFinite(data.hintsUsed)) return null;
  if (!isRecord(data.answers)) return null;

  const evidenceIds = new Set(caseData.evidence.map((e) => e.id));
  const validKeys = new Set(caseData.contradictions.map((c) => contradictionKey(c.claimId, c.evidenceId)));

  const answers: DeductionAnswers = {};
  for (const q of caseData.deduction) {
    const a = data.answers[q.id];
    if (typeof a === 'string' && q.options.some((o) => o.id === a)) answers[q.id] = a;
  }
  const complete = caseData.deduction.every((q) => q.id in answers);

  return {
    version: PROGRESS_VERSION,
    caseId: caseData.id,
    started: data.started,
    examined: [...new Set(examined.filter((id) => evidenceIds.has(id)))],
    hintsUsed: Math.max(0, Math.min(caseData.hints.length, Math.floor(data.hintsUsed))),
    contradictionsFound: [...new Set(found.filter((k) => validKeys.has(k)))],
    answers,
    // A submission is only meaningful with a complete answer set.
    submitted: data.submitted && complete,
  };
}

/** Minimal storage interface so tests can pass a fake and private-mode failures are survivable. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadProgress(caseData: CaseData, store: KeyValueStore | null): Progress {
  if (!store) return newProgress(caseData);
  try {
    return parseProgress(store.getItem(storageKey(caseData)), caseData) ?? newProgress(caseData);
  } catch {
    return newProgress(caseData);
  }
}

export function saveProgress(caseData: CaseData, progress: Progress, store: KeyValueStore | null): boolean {
  if (!store) return false;
  try {
    store.setItem(storageKey(caseData), JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

export function clearProgress(caseData: CaseData, store: KeyValueStore | null): void {
  try {
    store?.removeItem(storageKey(caseData));
  } catch {
    // Ignore: nothing useful to do if storage is unavailable.
  }
}

export function browserStore(): KeyValueStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
