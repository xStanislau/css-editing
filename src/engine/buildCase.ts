import type { CaseData, CaseRules, CaseText } from './types';
import { contradictionKey } from './logic';

/** Lists every missing, extra or mis-sized entry in a text bundle compared with its rules. Empty = complete. */
export function caseTextProblems(rules: CaseRules, text: CaseText): string[] {
  const problems: string[] = [];
  const sameKeys = (label: string, actual: Record<string, unknown>, expected: string[]) => {
    const have = new Set(Object.keys(actual));
    for (const k of expected) if (!have.has(k)) problems.push(`${label}: missing "${k}"`);
    for (const k of have) if (!expected.includes(k)) problems.push(`${label}: unexpected "${k}"`);
  };

  sameKeys('evidence', text.evidence, rules.evidenceIds);
  sameKeys('suspects', text.suspects, rules.suspects.map((s) => s.id));
  sameKeys('claims', text.claims, rules.suspects.flatMap((s) => s.claimIds));
  sameKeys('contradictions', text.contradictions, rules.contradictions.map((c) => contradictionKey(c.claimId, c.evidenceId)));
  sameKeys('deduction', text.deduction, rules.deduction.map((q) => q.id));
  for (const q of rules.deduction) {
    if (text.deduction[q.id]) sameKeys(`deduction.${q.id}.options`, text.deduction[q.id].options, q.optionIds);
  }
  if (text.hints.length !== rules.hintCount) problems.push(`hints: expected ${rules.hintCount}, got ${text.hints.length}`);
  if (text.intro.length === 0 || text.solution.explanation.length === 0) problems.push('intro/solution text is empty');
  return problems;
}

/** Merge language-free rules with one language's text. Throws on incomplete text so gaps fail loudly in dev and tests. */
export function buildCase(rules: CaseRules, text: CaseText): CaseData {
  const problems = caseTextProblems(rules, text);
  if (problems.length) throw new Error(`Case ${rules.id} text is incomplete:\n${problems.join('\n')}`);

  return {
    id: rules.id,
    title: text.title,
    tagline: text.tagline,
    intro: text.intro,
    question: text.question,
    evidence: rules.evidenceIds.map((id) => ({ id, ...text.evidence[id] })),
    suspects: rules.suspects.map((s) => ({
      id: s.id,
      ...text.suspects[s.id],
      claims: s.claimIds.map((id) => ({ id, text: text.claims[id] })),
    })),
    contradictions: rules.contradictions.map((c) => ({
      ...c,
      explanation: text.contradictions[contradictionKey(c.claimId, c.evidenceId)],
    })),
    noContradictionText: text.noContradictionText,
    hints: text.hints,
    deduction: rules.deduction.map((q) => ({
      id: q.id,
      prompt: text.deduction[q.id].prompt,
      options: q.optionIds.map((id) => ({ id, label: text.deduction[q.id].options[id] })),
      correctOptionId: q.correctOptionId,
    })),
    solution: text.solution,
    art: text.art,
  };
}
