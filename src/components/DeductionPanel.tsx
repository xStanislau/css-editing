import type { FormEvent } from 'react';
import { isDeductionComplete } from '../engine/logic';
import { useUi } from '../i18n/ui';
import type { PanelProps } from './Board';

export function DeductionPanel({ caseData, state, dispatch }: PanelProps) {
  const ui = useUi();
  const complete = isDeductionComplete(caseData, state.answers);
  const unseen = caseData.evidence.length - state.examined.length;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!complete) return;
    if (!window.confirm(ui.confirm.submit)) return;
    dispatch({ type: 'submit' });
  };

  return (
    <form className="deduction" onSubmit={submit}>
      <p className="muted">
        {ui.deduction.instructions}
        {unseen > 0 && ` ${ui.deduction.unexamined(unseen)}`}
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
        {ui.deduction.submit}
      </button>
      {!complete && <p className="muted">{ui.deduction.incomplete}</p>}
    </form>
  );
}
