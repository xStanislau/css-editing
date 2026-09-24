import { useState } from 'react';
import { contradictionKey, findContradiction } from '../engine/logic';
import { useUi } from '../i18n/ui';
import type { PanelProps } from './Board';
import { Placeholder } from './Placeholder';

// Stores the outcome, not text, so feedback re-renders in the new language after a switch.
interface Feedback {
  claimId: string;
  found: boolean;
}

export function SuspectsPanel({ caseData, state, dispatch }: PanelProps) {
  const ui = useUi();
  const [challenging, setChallenging] = useState<string | null>(null);
  const [choice, setChoice] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const examined = caseData.evidence.filter((e) => state.examined.includes(e.id));

  const foundFor = (claimId: string) =>
    caseData.contradictions.filter((c) => c.claimId === claimId && state.contradictionsFound.includes(contradictionKey(c.claimId, c.evidenceId)));

  const compare = (claimId: string) => {
    if (!choice) return;
    const hit = findContradiction(caseData, claimId, choice);
    dispatch({ type: 'challenge', claimId, evidenceId: choice });
    setFeedback({ claimId, found: !!hit });
  };

  return (
    <div>
      <p className="muted">{ui.suspects.instructions}</p>
      <div className="suspects">
        {caseData.suspects.map((s) => (
          <article key={s.id} className="suspect">
            <div className="suspect__head">
              <Placeholder label={s.artLabel} />
              <div>
                <h2>{s.name}</h2>
                <p className="suspect__role">{s.role}</p>
                <p className="muted">{s.description}</p>
              </div>
            </div>
            <ul className="claims">
              {s.claims.map((c) => {
                const found = foundFor(c.id);
                const isOpen = challenging === c.id;
                return (
                  <li key={c.id} className={`claim${found.length ? ' claim--broken' : ''}`}>
                    <blockquote>{ui.quote(c.text)}</blockquote>
                    {found.map((f) => (
                      <p key={f.evidenceId} className="contradiction">
                        <strong>{ui.suspects.contradiction}</strong> {caseData.evidence.find((e) => e.id === f.evidenceId)?.name}.{' '}
                        {f.explanation}
                      </p>
                    ))}
                    {!isOpen ? (
                      <button
                        className="btn btn--small"
                        onClick={() => {
                          setChallenging(c.id);
                          setChoice('');
                          setFeedback(null);
                        }}
                      >
                        {ui.suspects.challenge}
                      </button>
                    ) : (
                      <div className="challenge">
                        {examined.length === 0 ? (
                          <p className="muted">{ui.suspects.examineFirst}</p>
                        ) : (
                          <>
                            <label htmlFor={`pick-${c.id}`}>{ui.suspects.compareWith}</label>
                            <select
                              id={`pick-${c.id}`}
                              value={choice}
                              onChange={(e) => setChoice(e.target.value)}
                              autoFocus
                            >
                              <option value="">{ui.suspects.choosePlaceholder}</option>
                              {examined.map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.name}
                                </option>
                              ))}
                            </select>
                            <button className="btn btn--small btn--primary" onClick={() => compare(c.id)} disabled={!choice}>
                              {ui.suspects.compare}
                            </button>
                          </>
                        )}
                        <button className="btn btn--small btn--ghost" onClick={() => setChallenging(null)}>
                          {ui.suspects.cancel}
                        </button>
                        <p className="feedback" role="status">
                          {feedback?.claimId === c.id && (
                            <span className={feedback.found ? 'feedback--hit' : ''}>
                              {/* A hit is already logged above the claim, so only confirm it here. */}
                              {feedback.found ? `${ui.suspects.found} ${ui.suspects.loggedAbove}` : caseData.noContradictionText}
                            </span>
                          )}
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
