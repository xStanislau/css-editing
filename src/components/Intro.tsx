import type { CaseData } from '../engine/types';
import { Placeholder } from './Placeholder';

export function Intro({ caseData, onStart }: { caseData: CaseData; onStart: () => void }) {
  return (
    <div className="intro">
      <Placeholder label="Hotel Vesper at night in the storm, causeway under water" tall />
      <p className="eyebrow">Case 01</p>
      <h1>{caseData.title}</h1>
      <p className="tagline">{caseData.tagline}</p>
      {caseData.intro.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <div className="question-card">
        <h2>Your question</h2>
        <p>{caseData.question}</p>
      </div>
      <p className="muted">
        About 5–10 minutes. No timer. Everything you need is in the evidence. Progress saves automatically in this
        browser.
      </p>
      <button className="btn btn--primary" onClick={onStart} autoFocus>
        Begin the investigation
      </button>
    </div>
  );
}
