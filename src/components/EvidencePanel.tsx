import { useEffect, useRef, useState } from 'react';
import { useUi } from '../i18n/ui';
import type { PanelProps } from './Board';
import { Placeholder } from './Placeholder';

export function EvidencePanel({ caseData, state, dispatch }: PanelProps) {
  const ui = useUi();
  const [openId, setOpenId] = useState<string | null>(null);
  const detailRef = useRef<HTMLHeadingElement>(null);
  const open = caseData.evidence.find((e) => e.id === openId) ?? null;

  useEffect(() => {
    if (openId) detailRef.current?.focus();
  }, [openId]);

  const examine = (id: string) => {
    setOpenId(id);
    dispatch({ type: 'examine', evidenceId: id });
  };

  return (
    <div className="evidence">
      <ul className="evidence__list">
        {caseData.evidence.map((e) => {
          const seen = state.examined.includes(e.id);
          return (
            <li key={e.id}>
              <button
                className={`evidence-card${openId === e.id ? ' is-open' : ''}`}
                onClick={() => examine(e.id)}
                aria-expanded={openId === e.id}
                aria-controls="evidence-detail"
              >
                <span className="evidence-card__name">{e.name}</span>
                <span className="evidence-card__where">{e.foundAt}</span>
                <span className="evidence-card__summary">{e.summary}</span>
                <span className={`status${seen ? ' status--done' : ''}`}>{seen ? ui.evidence.examined : ui.evidence.notExamined}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div id="evidence-detail" className="evidence__detail" aria-live="polite">
        {open ? (
          <article>
            <h2 tabIndex={-1} ref={detailRef}>
              {open.name}
            </h2>
            <p className="muted">
              {ui.evidence.found} {open.foundAt}
            </p>
            <Placeholder label={open.artLabel} />
            <div className="document">
              {open.body.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
            <button className="btn btn--ghost" onClick={() => setOpenId(null)}>
              {ui.evidence.close}
            </button>
          </article>
        ) : (
          <p className="muted">{ui.evidence.choose}</p>
        )}
      </div>
    </div>
  );
}
