# Progress log

_Last updated: 2026-09-24_

## Current state
Checkpoints 0 and 1 are built and self-verified. **Russian localization is complete** and verified by the builder
(see below). **Checkpoint 2 is still waiting for real players; no human playtesting has happened in either language.**
There has been no commercial validation.

## Completed
- Moved the repository's original CSS demo to `legacy/css-live-editing/`, unchanged.
- Set up Vite 8 + React 19 + TypeScript + Vitest (0 npm audit findings at install time).
- Designed and self-reviewed the mystery: [`case-01-solution.md`](case-01-solution.md) ⚠️ spoilers.
- Engine (`src/engine/`): typed case model, contradiction lookup, deduction evaluation, case validator,
  pure reducer, and a versioned, validated `localStorage` save.
- Case content (`src/cases/case01/`): 3 suspects, 8 claims, 6 evidence items, 3 detectable contradictions,
  3 hints, and a 3-part deduction.
- UI: intro → tabbed board (Evidence / Suspects with "Challenge this statement" / Hints / Deduce) → verdict +
  explanation → restart. Placeholder art boxes are used throughout.
- **Russian localization (2026-09-24).** The case is split into language-free `rules.ts` (ids, contradictions,
  answers) and `en.ts` / `ru.ts` text, merged by `buildCase()`. Interface strings live in `src/i18n/ui.ts`
  (typed, en + ru). An "English / Русский" switch appears on every screen. The first visit follows the browser's
  top language, and an explicit choice is remembered (`vesper:locale`). `<html lang>` and the page title follow the
  language. Confirm dialogs, placeholder labels and aria labels are translated. No new dependencies.
- Playtest template: [`playtest-template.md`](playtest-template.md), including the language each tester used.

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

### Localization verification (2026-09-24)
- `npm test`: 30/30 pass (10 new). The new tests cover:
  - UI key parity (en = ru shape, no empty strings) and case-text parity (same keys and paragraph counts);
  - no Latin letters left in the Russian case text;
  - every document number matching after the 24-hour conversion;
  - identical rules in both builds;
  - locale detection and remembered choice, including junk values and throwing storage;
  - Russian plural forms;
  - a **mid-game switch en → ru → en that keeps progress and gives identical verdicts**;
  - a v0.1 English save loading unchanged in both languages.
  I confirmed the tests fail when a Russian time or a Latin word is introduced.
- `npm run build` passes.
- `scripts/smoke.mjs`: 151 checks pass: English at 1280 and 375 px, plus Russian at 1280, 375 and 320 px.
  - The Russian run starts from a `ru-RU` browser, plays through, reloads, switches language mid-game on the
    board, the deduction and the result screen, submits, and restarts.
  - It also checks `<html lang>`, the page title, the confirm-dialog text, answers and tab surviving a switch,
    the remembered choice beating the browser language, no visible or aria Latin text in Russian mode, no
    horizontal overflow, and a legacy English save loading.
- I reviewed the Russian screenshots at every width and fixed what they showed:
  - tab wrapping;
  - a Suspects-grid overflow at 320 px;
  - radio buttons shrinking;
  - wrapped question headings colliding with their border;
  - English quotation marks around Russian statements.
- The Russian solution was reviewed against the English map, including a gender audit. See the "Russian
  localization" section in `case-01-solution.md`.
- **Not verified:** native-speaker proofreading, screen-reader pronunciation (the switch buttons carry `lang=`), real
  phones, and the OK/Cancel labels in the browser's own confirm dialog (these follow the browser or OS language).

## Key decisions
- Case content is plain typed data, and the engine never references story ids. That makes the engine reusable for new cases.
- One submission gives a verdict and the explanation, and there is no retry without a restart. This discourages
  brute-forcing the 72 combinations.
- Contradictions are found by pairing a claim with *examined* evidence. There is no penalty for wrong pairings.
- Saves are keyed by case id and a version number. Invalid saves are discarded, and unknown ids are dropped.
- Restart and submit use `window.confirm` for simplicity. Swap in styled dialogs with the visual pass.
- Stack: current majors, because older Vite/Vitest had moderate audit advisories.
- Localization is hand-rolled (typed objects + `Intl.PluralRules`), with no i18n library. Case ids and the save
  key are language-free, so one save serves both languages and v0.1 saves still load.
- Russian adaptations that keep the meaning: 24-hour times (23:33, 00:30), «Ф.» for "F.", «О. В.» for "O.V.".

## Known weaknesses
- Julian's location is easy once the note is read. The challenge is *who*, and the whole case may run
  shorter than 5 minutes for experienced players.
- The "only woman at dinner" and "only four people in the hotel" facts come from the premise, not from clues.
- Felix and Odile give each other an alibi at 11:30. Collusion isn't ruled out by evidence, only unsupported.
- The contradiction tool can be brute-forced (8 claims × 6 evidence items), and it isn't required before
  deducing. It may make the case too easy or too hand-held. Playtesting needs to show which.
- Answer option labels in the deduction show all locations, which slightly frames the solution space.
- No sound, no art, and `window.confirm` dialogs look plain.
- The Russian text was written and reviewed by the builder, not by a native-speaker editor.
- At 320 px the Russian tab row wraps to two lines ("Вывод" moves to the second row). It works but looks less tidy.
- The `<meta name="description">` in `index.html` stays English (search and preview only, not shown in-game).

## Blockers
None.

## Next action
**Checkpoint 2:** have three people who haven't seen the solution play `npm run dev` (or a local build), each
logged with [`playtest-template.md`](playtest-template.md). Record the language each tester played in. If
possible, include at least one native Russian speaker and ask them to flag unnatural wording.
