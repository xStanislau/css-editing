import type { PanelProps } from './Board';

export function HintsPanel({ caseData, state, dispatch }: PanelProps) {
  const remaining = caseData.hints.length - state.hintsUsed;
  return (
    <div className="hints">
      <p className="muted">Hints get more direct as you go. Reveal only as many as you need.</p>
      <ol className="hints__list" aria-live="polite">
        {caseData.hints.slice(0, state.hintsUsed).map((h, i) => (
          <li key={i} className="hint">
            <span className="hint__label">Hint {i + 1}</span>
            <p>{h}</p>
          </li>
        ))}
      </ol>
      {remaining > 0 ? (
        <button className="btn" onClick={() => dispatch({ type: 'revealHint' })}>
          Reveal hint {state.hintsUsed + 1} of {caseData.hints.length}
        </button>
      ) : (
        <p className="muted">No more hints. The answer is in the evidence.</p>
      )}
    </div>
  );
}
