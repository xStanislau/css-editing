import { useUi } from '../i18n/ui';
import type { PanelProps } from './Board';

export function HintsPanel({ caseData, state, dispatch }: PanelProps) {
  const ui = useUi();
  const remaining = caseData.hints.length - state.hintsUsed;
  return (
    <div className="hints">
      <p className="muted">{ui.hints.intro}</p>
      <ol className="hints__list" aria-live="polite">
        {caseData.hints.slice(0, state.hintsUsed).map((h, i) => (
          <li key={i} className="hint">
            <span className="hint__label">{ui.hints.label(i + 1)}</span>
            <p>{h}</p>
          </li>
        ))}
      </ol>
      {remaining > 0 ? (
        <button className="btn" onClick={() => dispatch({ type: 'revealHint' })}>
          {ui.hints.reveal(state.hintsUsed + 1, caseData.hints.length)}
        </button>
      ) : (
        <p className="muted">{ui.hints.none}</p>
      )}
    </div>
  );
}
