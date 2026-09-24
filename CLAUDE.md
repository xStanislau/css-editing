# Notes for future sessions

- Read `docs/progress.md` first. It is the source of truth for status, decisions and the next action.
- The solution map is in `docs/case-01-solution.md` (spoilers). Keep it in sync with `src/cases/case01/` (rules + en + ru).
- Every player-facing string exists in English and Russian. Change both together: interface text in `src/i18n/ui.ts`,
  case text in `src/cases/case01/{en,ru}.ts`. Russian documents use 24-hour times (see the solution map).
- Keep story content in `src/cases/`. `src/engine/` must stay case-agnostic.
- Checks: `npm test && npm run build`. Browser smoke: see the header of `scripts/smoke.mjs`.
- Don't mark playtesting or commercial checkpoints complete without recorded evidence.
- Out of scope unless asked: backend, accounts, analytics, payments, runtime AI, paid asset generation.
