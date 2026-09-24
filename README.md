# The Last Guest at Hotel Vesper

A short (5–10 minute) browser mystery. During a storm on a tidal island, one hotel guest vanishes.
The player examines evidence, challenges suspect statements, and submits a three-part deduction.

**Status:** Checkpoint 0 (setup) and Checkpoint 1 (playable slice) are built. No player testing has happened yet.
See [`docs/progress.md`](docs/progress.md).

## Run it

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine unit tests (Vitest)
npm run typecheck  # TypeScript
npm run build      # typecheck + production build → dist/
npm run preview    # serve dist/ at http://localhost:4173
```

`dist/` is a static site with relative asset paths. There is no backend, no accounts and no API keys.

An optional browser smoke test (full flow, desktop + phone, including malformed saves) is in `scripts/smoke.mjs`.
Instructions are in its header.

## Prototype overview

- **One location, three suspects, six evidence items, three hints**, and one question with a single correct answer.
- **Challenge a statement** by comparing a suspect's claim with an examined piece of evidence. Real contradictions
  are logged, and wrong pairings give neutral feedback.
- **Deduction**: where Julian is, who is responsible, and which record proves it. You get one verdict, followed by the full explanation.
- **Progress** saves to `localStorage` automatically. Corrupt or tampered saves fall back to a fresh game. There is a restart button.
- Keyboard-accessible (native buttons and radios, ARIA tabs with arrow keys, visible focus), and responsive down to 320px.
- All art is labelled **placeholder** boxes. The label text doubles as an art brief.
- **English and Russian.** The first visit follows the browser's preferred language, and an explicit choice from the
  "English / Русский" switch is remembered. Switching keeps progress on every screen.

## Layout

```
src/engine/     Case-agnostic logic: types, buildCase (rules + text), checks, reducer, save/load (+ tests)
src/cases/      Case content: case01/rules.ts (ids, answers), en.ts / ru.ts (text). ⚠️ contains the solution
src/i18n/       Language detection/choice, interface strings for en + ru (+ parity tests)
src/components/ React screens: Intro, Board (Evidence / Suspects / Hints / Deduce tabs), Result
docs/           brief, roadmap, progress, playtest template, case-01-solution (⚠️ spoilers)
legacy/         The repository's original CSS live-editing demo, kept untouched
```

To add a case, write `rules.ts` plus one text file per language, build them with `buildCase()`, and pass the
result to `<App cases={...} />` in `src/main.tsx`. `buildCase()` throws if any text is missing.
To add a language, add it to `LOCALES` in `src/i18n/locale.ts`. TypeScript then points at every missing string.
