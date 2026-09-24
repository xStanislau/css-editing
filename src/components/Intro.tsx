import type { CaseData } from '../engine/types';
import { useUi } from '../i18n/ui';
import { Placeholder } from './Placeholder';

export function Intro({ caseData, onStart }: { caseData: CaseData; onStart: () => void }) {
  const ui = useUi();
  return (
    <div className="intro">
      <Placeholder label={caseData.art.cover} tall />
      <p className="eyebrow">{ui.caseLabel}</p>
      <h1>{caseData.title}</h1>
      <p className="tagline">{caseData.tagline}</p>
      {caseData.intro.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <div className="question-card">
        <h2>{ui.intro.yourQuestion}</h2>
        <p>{caseData.question}</p>
      </div>
      <p className="muted">{ui.intro.timeNote}</p>
      <button className="btn btn--primary" onClick={onStart} autoFocus>
        {ui.intro.begin}
      </button>
    </div>
  );
}
