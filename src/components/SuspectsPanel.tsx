import { useState } from 'react';
import { contradictionKey, findContradiction } from '../engine/logic';
import type { PanelProps } from './Board';
import { Placeholder } from './Placeholder';

interface Feedback {
  claimId: string;
  found: boolean;
  text: string;
}

export function SuspectsPanel({ caseData, state, dispatch }: PanelProps) {
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
    // A hit is already logged above the claim, so only confirm it here.
    setFeedback({ claimId, found: !!hit, text: hit ? 'Logged above.' : caseData.noContradictionText });
  };

  return (
    <div>
      <p className="muted">
        Challenge a statement with evidence you have examined. If a record proves the statement false, it is logged
        as a contradiction.
      </p>
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
                    <blockquote>“{c.text}”</blockquote>
                    {found.map((f) => (
                      <p key={f.evidenceId} className="contradiction">
                        <strong>Contradiction:</strong> {caseData.evidence.find((e) => e.id === f.evidenceId)?.name}.{' '}
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
                        Challenge this statement
                      </button>
                    ) : (
                      <div className="challenge">
                        {examined.length === 0 ? (
                          <p className="muted">Examine some evidence first.</p>
                        ) : (
                          <>
                            <label htmlFor={`pick-${c.id}`}>Compare with:</label>
                            <select
                              id={`pick-${c.id}`}
                              value={choice}
                              onChange={(e) => setChoice(e.target.value)}
                              autoFocus
                            >
                              <option value="">Choose examined evidence…</option>
                              {examined.map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.name}
                                </option>
                              ))}
                            </select>
                            <button className="btn btn--small btn--primary" onClick={() => compare(c.id)} disabled={!choice}>
                              Compare
                            </button>
                          </>
                        )}
                        <button className="btn btn--small btn--ghost" onClick={() => setChallenging(null)}>
                          Cancel
                        </button>
                        <p className="feedback" role="status">
                          {feedback?.claimId === c.id && (
                            <span className={feedback.found ? 'feedback--hit' : ''}>
                              {feedback.found ? 'Contradiction found. ' : ''}
                              {feedback.text}
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
