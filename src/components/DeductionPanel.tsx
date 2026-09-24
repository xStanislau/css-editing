import type { FormEvent } from 'react';
import { isDeductionComplete } from '../engine/logic';
import type { PanelProps } from './Board';

export function DeductionPanel({ caseData, state, dispatch }: PanelProps) {
  const complete = isDeductionComplete(caseData, state.answers);
  const unseen = caseData.evidence.length - state.examined.length;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!complete) return;
    if (!window.confirm('Submit your deduction? This closes the case and reveals the solution.')) return;
    dispatch({ type: 'submit' });
  };

  return (
    <form className="deduction" onSubmit={submit}>
      <p className="muted">
        Answer all three parts, then submit. You get one verdict, and the full explanation follows.
        {unseen > 0 && ` You have ${unseen} unexamined item${unseen === 1 ? '' : 's'} of evidence.`}
      </p>
      {caseData.deduction.map((q) => (
        <fieldset key={q.id} className="deduction__q">
          <legend>{q.prompt}</legend>
          <div className="options">
            {q.options.map((o) => (
              <label key={o.id} className="option">
                <input
                  type="radio"
                  name={q.id}
                  value={o.id}
                  checked={state.answers[q.id] === o.id}
                  onChange={() => dispatch({ type: 'answer', questionId: q.id, optionId: o.id })}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <button type="submit" className="btn btn--primary" disabled={!complete}>
        Submit deduction
      </button>
      {!complete && <p className="muted">Choose an answer for every part to submit.</p>}
    </form>
  );
}
