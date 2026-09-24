import { useRef, useState, type Dispatch, type KeyboardEvent } from 'react';
import type { CaseData } from '../engine/types';
import type { Progress } from '../engine/progress';
import type { Action } from '../engine/reducer';
import { EvidencePanel } from './EvidencePanel';
import { SuspectsPanel } from './SuspectsPanel';
import { HintsPanel } from './HintsPanel';
import { DeductionPanel } from './DeductionPanel';

export interface PanelProps {
  caseData: CaseData;
  state: Progress;
  dispatch: Dispatch<Action>;
}

const TABS = [
  { id: 'evidence', label: 'Evidence' },
  { id: 'suspects', label: 'Suspects' },
  { id: 'hints', label: 'Hints' },
  { id: 'deduce', label: 'Deduce' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function Board({ caseData, state, dispatch, onRestart }: PanelProps & { onRestart: () => void }) {
  const [tab, setTab] = useState<TabId>('evidence');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // WAI-ARIA tabs pattern: arrow keys / Home / End move between tabs.
  const onTabKey = (e: KeyboardEvent, index: number) => {
    const last = TABS.length - 1;
    const next =
      e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  const badge = (id: TabId) =>
    id === 'evidence' ? `${state.examined.length}/${caseData.evidence.length}`
    : id === 'suspects' ? (state.contradictionsFound.length ? `${state.contradictionsFound.length} ✦` : '')
    : id === 'hints' ? `${state.hintsUsed}/${caseData.hints.length}`
    : '';

  return (
    <div className="board">
      <header className="board__header">
        <div>
          <p className="eyebrow">Hotel Vesper · Case 01</p>
          <h1 className="board__title">{caseData.title}</h1>
        </div>
        <button className="btn btn--ghost" onClick={onRestart}>
          Restart
        </button>
      </header>
      <p className="question-line">
        <strong>Question:</strong> {caseData.question}
      </p>

      <div role="tablist" aria-label="Case sections" className="tabs">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className="tab"
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
            {badge(t.id) && <span className="tab__badge"> {badge(t.id)}</span>}
          </button>
        ))}
      </div>

      <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="panel">
        {tab === 'evidence' && <EvidencePanel caseData={caseData} state={state} dispatch={dispatch} />}
        {tab === 'suspects' && <SuspectsPanel caseData={caseData} state={state} dispatch={dispatch} />}
        {tab === 'hints' && <HintsPanel caseData={caseData} state={state} dispatch={dispatch} />}
        {tab === 'deduce' && <DeductionPanel caseData={caseData} state={state} dispatch={dispatch} />}
      </section>
    </div>
  );
}
