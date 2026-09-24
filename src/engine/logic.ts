import type { CaseData, Contradiction } from './types';

export type DeductionAnswers = Record<string, string>;

export interface DeductionResult {
  correct: boolean;
  /** Per question id: whether the chosen option was correct. */
  parts: Record<string, boolean>;
}

export function contradictionKey(claimId: string, evidenceId: string): string {
  return `${claimId}|${evidenceId}`;
}

/** Returns the matching contradiction, or null when the evidence does not contradict the claim. */
export function findContradiction(
  caseData: CaseData,
  claimId: string,
  evidenceId: string,
): Contradiction | null {
  return (
    caseData.contradictions.find((c) => c.claimId === claimId && c.evidenceId === evidenceId) ?? null
  );
}

export function isDeductionComplete(caseData: CaseData, answers: DeductionAnswers): boolean {
  return caseData.deduction.every((q) => q.options.some((o) => o.id === answers[q.id]));
}

export function evaluateDeduction(caseData: CaseData, answers: DeductionAnswers): DeductionResult {
  const parts: Record<string, boolean> = {};
  for (const q of caseData.deduction) parts[q.id] = answers[q.id] === q.correctOptionId;
  return { correct: Object.values(parts).every(Boolean), parts };
}

/**
 * Developer sanity check for authored cases: every referenced id must exist
 * and every deduction answer must be one of its options. Returns problems found.
 */
export function validateCase(caseData: CaseData): string[] {
  const problems: string[] = [];
  const evidenceIds = new Set(caseData.evidence.map((e) => e.id));
  const claimIds = new Set(caseData.suspects.flatMap((s) => s.claims.map((c) => c.id)));
  const allIds = [...caseData.evidence.map((e) => e.id), ...claimIds, ...caseData.suspects.map((s) => s.id)];
  if (new Set(allIds).size !== allIds.length) problems.push('duplicate ids');
  for (const c of caseData.contradictions) {
    if (!claimIds.has(c.claimId)) problems.push(`contradiction references unknown claim ${c.claimId}`);
    if (!evidenceIds.has(c.evidenceId)) problems.push(`contradiction references unknown evidence ${c.evidenceId}`);
  }
  for (const q of caseData.deduction) {
    if (!q.options.some((o) => o.id === q.correctOptionId)) problems.push(`question ${q.id} has no valid answer`);
  }
  if (caseData.contradictions.length === 0) problems.push('case has no contradictions');
  return problems;
}
