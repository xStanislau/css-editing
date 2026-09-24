// Case data shapes. A case is pure data; the engine and UI never hard-code story content.

export interface Evidence {
  id: string;
  name: string;
  /** Where in the location the item was found. */
  foundAt: string;
  /** One-line teaser shown on the evidence card. */
  summary: string;
  /** Full text shown when examined. Each entry is a paragraph or a transcribed line. */
  body: string[];
  /** Short label for the placeholder art box until final art exists. */
  artLabel: string;
}

export interface Claim {
  id: string;
  text: string;
}

export interface Suspect {
  id: string;
  name: string;
  role: string;
  description: string;
  artLabel: string;
  claims: Claim[];
}

/** A claim/evidence pair the player can flag as contradictory. */
export interface Contradiction {
  claimId: string;
  evidenceId: string;
  /** Shown when the player finds it. Must not reveal the final answer outright. */
  explanation: string;
}

export interface DeductionOption {
  id: string;
  label: string;
}

export interface DeductionQuestion {
  id: string;
  prompt: string;
  options: DeductionOption[];
  correctOptionId: string;
}

export interface CaseData {
  id: string;
  title: string;
  tagline: string;
  /** Opening briefing paragraphs. */
  intro: string[];
  /** The question the player must answer, in plain words. */
  question: string;
  evidence: Evidence[];
  suspects: Suspect[];
  contradictions: Contradiction[];
  /** Feedback when a challenged claim is not contradicted by the chosen evidence. */
  noContradictionText: string;
  /** Progressively more helpful; last one should nearly name the answer. */
  hints: string[];
  deduction: DeductionQuestion[];
  solution: {
    headline: string;
    /** Shown after submission regardless of correctness. */
    explanation: string[];
  };
}
