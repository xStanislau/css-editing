import type { CaseData } from '../engine/types';
import type { Progress } from '../engine/progress';
import { evaluateDeduction } from '../engine/logic';
import { Placeholder } from './Placeholder';

export function Result({ caseData, state, onRestart }: { caseData: CaseData; state: Progress; onRestart: () => void }) {
  const result = evaluateDeduction(caseData, state.answers);
  const label = (qId: string, oId: string | undefined) =>
    caseData.deduction.find((q) => q.id === qId)?.options.find((o) => o.id === oId)?.label ?? '—';

  return (
    <div className="result">
      <p className="eyebrow">Case 01 · Verdict</p>
      <h1>{result.correct ? 'Case solved.' : 'Not quite.'}</h1>
      <p className="tagline">
        {result.correct
          ? 'Your reasoning holds. Every piece of evidence fits.'
          : 'Part of your answer does not fit the evidence. Here is what really happened.'}
      </p>

      <ul className="verdict">
        {caseData.deduction.map((q) => {
          const ok = result.parts[q.id];
          return (
            <li key={q.id} className={ok ? 'verdict--ok' : 'verdict--bad'}>
              <span className="verdict__mark" aria-hidden="true">
                {ok ? '✓' : '✗'}
              </span>
              <span>
                <strong>{q.prompt}</strong>
                <br />
                You said: {label(q.id, state.answers[q.id])}
                <span className="visually-hidden">{ok ? ' (correct)' : ' (incorrect)'}</span>
                {!ok && (
                  <>
                    <br />
                    Answer: {label(q.id, q.correctOptionId)}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <Placeholder label="The wine store door, bolt drawn back, lantern light inside" />
      <h2>{caseData.solution.headline}</h2>
      {caseData.solution.explanation.map((p, i) => (
        <p key={i}>{p}</p>
      ))}

      <p className="muted">
        Hints used: {state.hintsUsed}/{caseData.hints.length} · Evidence examined: {state.examined.length}/
        {caseData.evidence.length} · Contradictions found: {state.contradictionsFound.length}/
        {caseData.contradictions.length}
      </p>
      <button className="btn btn--primary" onClick={onRestart}>
        Restart the case
      </button>
    </div>
  );
}
