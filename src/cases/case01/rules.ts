import type { CaseRules } from '../../engine/types';

// Language-free game rules for Case 01. Ids are stable save-game keys: never rename them.
// SPOILER NOTE: the solution map lives in docs/case-01-solution.md. Keep them in sync.

export const rules: CaseRules = {
  id: 'case-01-vesper',
  evidenceIds: ['note', 'notebook', 'register', 'shoes', 'generator', 'notice'],
  suspects: [
    { id: 'ruth', claimIds: ['ruth-room', 'ruth-outside', 'ruth-stranger'] },
    { id: 'felix', claimIds: ['felix-argue', 'felix-library', 'felix-pencil'] },
    { id: 'odile', claimIds: ['odile-desk', 'odile-nobody'] },
  ],
  contradictions: [
    { claimId: 'ruth-outside', evidenceId: 'shoes' },
    { claimId: 'odile-desk', evidenceId: 'generator' },
    { claimId: 'odile-desk', evidenceId: 'shoes' },
  ],
  hintCount: 3,
  deduction: [
    { id: 'where', optionIds: ['wine-store', 'boiler-room', 'library', 'mainland'], correctOptionId: 'wine-store' },
    { id: 'who', optionIds: ['ruth', 'felix', 'odile'], correctOptionId: 'ruth' },
    {
      id: 'proof',
      optionIds: ['note', 'notebook', 'register', 'shoes', 'generator', 'notice'],
      correctOptionId: 'shoes',
    },
  ],
};
