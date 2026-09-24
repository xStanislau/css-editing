import type { CaseData } from './types';
import { contradictionKey, findContradiction, isDeductionComplete } from './logic';
import { newProgress, type Progress } from './progress';

export type Action =
  | { type: 'start' }
  | { type: 'examine'; evidenceId: string }
  | { type: 'revealHint' }
  | { type: 'challenge'; claimId: string; evidenceId: string }
  | { type: 'answer'; questionId: string; optionId: string }
  | { type: 'submit' }
  | { type: 'restart' };

export function reduce(caseData: CaseData, state: Progress, action: Action): Progress {
  switch (action.type) {
    case 'start':
      return { ...state, started: true };
    case 'examine':
      if (state.examined.includes(action.evidenceId)) return state;
      if (!caseData.evidence.some((e) => e.id === action.evidenceId)) return state;
      return { ...state, examined: [...state.examined, action.evidenceId] };
    case 'revealHint':
      return { ...state, hintsUsed: Math.min(caseData.hints.length, state.hintsUsed + 1) };
    case 'challenge': {
      const hit = findContradiction(caseData, action.claimId, action.evidenceId);
      const key = contradictionKey(action.claimId, action.evidenceId);
      if (!hit || state.contradictionsFound.includes(key)) return state;
      return { ...state, contradictionsFound: [...state.contradictionsFound, key] };
    }
    case 'answer':
      if (state.submitted) return state;
      return { ...state, answers: { ...state.answers, [action.questionId]: action.optionId } };
    case 'submit':
      if (!isDeductionComplete(caseData, state.answers)) return state;
      return { ...state, submitted: true };
    case 'restart':
      return newProgress(caseData);
  }
}
