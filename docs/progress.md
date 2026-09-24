# Progress log

_Last updated: 2026-09-24_

## Current state
Checkpoints 0 and 1 are built and self-verified. **No human player testing has been done yet.**
There has been no commercial validation.

## Completed
- Moved the repository's original CSS demo to `legacy/css-live-editing/`, unchanged.
- Set up Vite 8 + React 19 + TypeScript + Vitest (0 npm audit findings at install time).
- Designed and self-reviewed the mystery: [`case-01-solution.md`](case-01-solution.md) ⚠️ spoilers.
- Engine (`src/engine/`): typed case model, contradiction lookup, deduction evaluation, case validator,
  pure reducer, and a versioned, validated `localStorage` save.
- Case content (`src/cases/case01.ts`): 3 suspects, 8 claims, 6 evidence items, 3 detectable contradictions,
  3 hints, and a 3-part deduction.
- UI: intro → tabbed board (Evidence / Suspects with "Challenge this statement" / Hints / Deduce) → verdict +
  explanation → restart. Placeholder art boxes are used throughout.

## Verification (all run on 2026-09-24)
- `npm run build`: typecheck and production build pass. I confirmed that `tsc -b` fails on a deliberate type error.
- `npm test`: 20/20 pass. The tests cover case consistency, exactly 1 of 72 answer combinations being correct,
  per-part feedback, reducer flow, restart, hint cap, the save round-trip, 8 malformed-save variants,
  tampered-save sanitising, and throwing storage.
- `scripts/smoke.mjs` in headless Chromium at 1280×900 and 375×740: all 19 checks pass on each. It covers keyboard
  start, all evidence, arrow-key tabs, wrong and right challenges, a hint, persistence across reload, correct and
  wrong verdicts, restart, a malformed save, and no horizontal overflow. It reported no console errors.
  The tab row fits at 320px.
- I reviewed screenshots of each screen by eye.
- Not done: screen-reader testing, real devices (iOS Safari / Android), and players other than the builder.

## Key decisions
- Case content is plain typed data, and the engine never references story ids. That makes the engine reusable for new cases.
- One submission gives a verdict and the explanation, and there is no retry without a restart. This discourages
  brute-forcing the 72 combinations.
- Contradictions are found by pairing a claim with *examined* evidence. There is no penalty for wrong pairings.
- Saves are keyed by case id and a version number. Invalid saves are discarded, and unknown ids are dropped.
- Restart and submit use `window.confirm` for simplicity. Swap in styled dialogs with the visual pass.
- Stack: current majors, because older Vite/Vitest had moderate audit advisories.

## Known weaknesses
- Julian's location is easy once the note is read. The challenge is *who*, and the whole case may run
  shorter than 5 minutes for experienced players.
- The "only woman at dinner" and "only four people in the hotel" facts come from the premise, not from clues.
- Felix and Odile give each other an alibi at 11:30. Collusion isn't ruled out by evidence, only unsupported.
- The contradiction tool can be brute-forced (8 claims × 6 evidence items), and it isn't required before
  deducing. It may make the case too easy or too hand-held. Playtesting needs to show which.
- Answer option labels in the deduction show all locations, which slightly frames the solution space.
- No sound, no art, and `window.confirm` dialogs look plain.

## Blockers
None.

## Next action
**Checkpoint 2:** have three people who haven't seen the solution play `npm run dev` (or a local build).
Record for each: whether they solved it, how long it took, hints used, which contradictions they found, and where they hesitated.
