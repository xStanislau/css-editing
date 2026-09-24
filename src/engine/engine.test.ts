import { describe, expect, it } from 'vitest';
import { case01 } from '../cases/case01';
import { contradictionKey, evaluateDeduction, findContradiction, validateCase } from './logic';
import {
  loadProgress,
  newProgress,
  parseProgress,
  saveProgress,
  storageKey,
  type KeyValueStore,
} from './progress';
import { reduce } from './reducer';

const correct = { where: 'wine-store', who: 'ruth', proof: 'shoes' };

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

describe('case 01 content', () => {
  it('is internally consistent', () => {
    expect(validateCase(case01)).toEqual([]);
  });

  it('meets the prototype scope', () => {
    expect(case01.suspects).toHaveLength(3);
    expect(case01.evidence).toHaveLength(6);
    expect(case01.hints).toHaveLength(3);
  });

  it('flags the key contradiction: Ruth claims she never went outside, the shoe list shows clay', () => {
    expect(findContradiction(case01, 'ruth-outside', 'shoes')).not.toBeNull();
  });

  it('never marks the framed or truthful statements as contradicted', () => {
    const truthful = ['felix-argue', 'felix-library', 'felix-pencil', 'odile-nobody'];
    for (const claimId of truthful) {
      for (const e of case01.evidence) expect(findContradiction(case01, claimId, e.id)).toBeNull();
    }
  });
});

describe('deduction', () => {
  it('accepts exactly one full answer', () => {
    let correctCount = 0;
    const [where, who, proof] = case01.deduction;
    for (const a of where.options)
      for (const b of who.options)
        for (const c of proof.options) {
          if (evaluateDeduction(case01, { where: a.id, who: b.id, proof: c.id }).correct) correctCount++;
        }
    expect(correctCount).toBe(1);
    expect(evaluateDeduction(case01, correct).correct).toBe(true);
  });

  it('reports which parts are wrong', () => {
    const r = evaluateDeduction(case01, { ...correct, who: 'felix' });
    expect(r.correct).toBe(false);
    expect(r.parts).toEqual({ where: true, who: false, proof: true });
  });

  it('treats missing answers as incorrect and will not submit them', () => {
    expect(evaluateDeduction(case01, {}).correct).toBe(false);
    const s = reduce(case01, newProgress(case01), { type: 'submit' });
    expect(s.submitted).toBe(false);
  });
});

describe('reducer', () => {
  it('runs the full flow and restart clears everything', () => {
    let s = newProgress(case01);
    s = reduce(case01, s, { type: 'start' });
    s = reduce(case01, s, { type: 'examine', evidenceId: 'shoes' });
    s = reduce(case01, s, { type: 'examine', evidenceId: 'shoes' });
    s = reduce(case01, s, { type: 'revealHint' });
    s = reduce(case01, s, { type: 'challenge', claimId: 'ruth-outside', evidenceId: 'shoes' });
    s = reduce(case01, s, { type: 'challenge', claimId: 'felix-library', evidenceId: 'shoes' });
    for (const [q, o] of Object.entries(correct)) s = reduce(case01, s, { type: 'answer', questionId: q, optionId: o });
    s = reduce(case01, s, { type: 'submit' });
    expect(s).toMatchObject({ started: true, examined: ['shoes'], hintsUsed: 1, submitted: true });
    expect(s.contradictionsFound).toEqual([contradictionKey('ruth-outside', 'shoes')]);
    expect(reduce(case01, s, { type: 'restart' })).toEqual(newProgress(case01));
  });

  it('caps hints at the number available', () => {
    let s = newProgress(case01);
    for (let i = 0; i < 10; i++) s = reduce(case01, s, { type: 'revealHint' });
    expect(s.hintsUsed).toBe(3);
  });
});

describe('saved progress', () => {
  it('round-trips through storage', () => {
    const store = memoryStore();
    let s = reduce(case01, newProgress(case01), { type: 'start' });
    s = reduce(case01, s, { type: 'examine', evidenceId: 'note' });
    expect(saveProgress(case01, s, store)).toBe(true);
    expect(loadProgress(case01, store)).toEqual(s);
  });

  it.each([
    ['not JSON', '{oops'],
    ['JSON null', 'null'],
    ['an array', '[1,2,3]'],
    ['a string', '"hello"'],
    ['wrong version', JSON.stringify({ ...newProgress(case01), version: 99 })],
    ['another case', JSON.stringify({ ...newProgress(case01), caseId: 'case-99' })],
    ['wrong field types', JSON.stringify({ ...newProgress(case01), examined: 'note', hintsUsed: '2' })],
    ['NaN hints', JSON.stringify({ ...newProgress(case01), hintsUsed: null })],
  ])('falls back to a fresh game for %s', (_label, raw) => {
    const store = memoryStore({ [storageKey(case01)]: raw });
    expect(loadProgress(case01, store)).toEqual(newProgress(case01));
  });

  it('drops unknown ids and clamps values from a tampered save', () => {
    const raw = JSON.stringify({
      ...newProgress(case01),
      started: true,
      examined: ['note', 'note', 'ghost'],
      hintsUsed: 42,
      contradictionsFound: [contradictionKey('ruth-outside', 'shoes'), 'felix-argue|note'],
      answers: { where: 'wine-store', who: 'nobody', extra: 'x' },
      submitted: true,
    });
    const p = parseProgress(raw, case01);
    expect(p).not.toBeNull();
    expect(p!.examined).toEqual(['note']);
    expect(p!.hintsUsed).toBe(3);
    expect(p!.contradictionsFound).toEqual([contradictionKey('ruth-outside', 'shoes')]);
    expect(p!.answers).toEqual({ where: 'wine-store' });
    // Incomplete answers can't stay "submitted".
    expect(p!.submitted).toBe(false);
  });

  it('survives storage that throws (e.g. private browsing)', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    expect(loadProgress(case01, broken)).toEqual(newProgress(case01));
    expect(saveProgress(case01, newProgress(case01), broken)).toBe(false);
    expect(loadProgress(case01, null)).toEqual(newProgress(case01));
  });
});
