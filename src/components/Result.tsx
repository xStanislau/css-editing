import type { CaseData } from '../engine/types';
import type { Progress } from '../engine/progress';
import { evaluateDeduction } from '../engine/logic';
import { useUi } from '../i18n/ui';
import { Placeholder } from './Placeholder';

export function Result({ caseData, state, onRestart }: { caseData: CaseData; state: Progress; onRestart: () => void }) {
  const ui = useUi();
  const result = evaluateDeduction(caseData, state.answers);
  const label = (qId: string, oId: string | undefined) =>
    caseData.deduction.find((q) => q.id === qId)?.options.find((o) => o.id === oId)?.label ?? '—';

  return (
    <div className="result">
      <p className="eyebrow">{ui.result.eyebrow}</p>
      <h1>{result.correct ? ui.result.solved : ui.result.notQuite}</h1>
      <p className="tagline">
        {result.correct ? ui.result.solvedTagline : ui.result.notQuiteTagline}
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
                {ui.result.youSaid} {label(q.id, state.answers[q.id])}
                <span className="visually-hidden">{` ${ok ? ui.result.correct : ui.result.incorrect}`}</span>
                {!ok && (
                  <>
                    <br />
                    {ui.result.answer} {label(q.id, q.correctOptionId)}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <Placeholder label={caseData.art.reveal} />
      <h2>{caseData.solution.headline}</h2>
      {caseData.solution.explanation.map((p, i) => (
        <p key={i}>{p}</p>
      ))}

      <p className="muted">
        {ui.result.stats({
          hints: `${state.hintsUsed}/${caseData.hints.length}`,
          evidence: `${state.examined.length}/${caseData.evidence.length}`,
          contradictions: `${state.contradictionsFound.length}/${caseData.contradictions.length}`,
        })}
      </p>
      <button className="btn btn--primary" onClick={onRestart}>
        {ui.result.restart}
      </button>
    </div>
  );
}
