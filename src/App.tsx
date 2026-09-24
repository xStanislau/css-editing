import { useEffect, useReducer, useRef, useState } from 'react';
import type { CaseData } from './engine/types';
import { browserStore, clearProgress, loadProgress, saveProgress } from './engine/progress';
import { reduce, type Action } from './engine/reducer';
import { browserLanguages, loadLocale, saveLocale, type Locale } from './i18n/locale';
import { UiContext, uiStrings } from './i18n/ui';
import { LanguageSwitch } from './components/LanguageSwitch';
import { Intro } from './components/Intro';
import { Board } from './components/Board';
import { Result } from './components/Result';

/** `cases` holds one case in every language; all versions share ids and rules, so progress is language-independent. */
export function App({ cases }: { cases: Record<Locale, CaseData> }) {
  const store = useRef(browserStore()).current;
  const [locale, setLocale] = useState<Locale>(() => loadLocale(store, browserLanguages()));
  const caseData = cases[locale];
  const ui = uiStrings[locale];

  const [state, dispatch] = useReducer(
    (s: ReturnType<typeof loadProgress>, a: Action) => reduce(caseData, s, a),
    null,
    () => loadProgress(caseData, store),
  );

  useEffect(() => {
    saveProgress(caseData, state, store);
  }, [caseData, state, store]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = caseData.title;
  }, [locale, caseData.title]);

  const chooseLocale = (next: Locale) => {
    saveLocale(store, next);
    setLocale(next);
  };

  const restart = () => {
    if (!window.confirm(ui.confirm.restart)) return;
    clearProgress(caseData, store);
    dispatch({ type: 'restart' });
  };

  // Move focus to the top of each new screen so keyboard and screen-reader users start there.
  const screen = !state.started ? 'intro' : state.submitted ? 'result' : 'board';
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus();
    window.scrollTo(0, 0);
  }, [screen]);

  return (
    <UiContext.Provider value={ui}>
      <div className="topbar">
        <LanguageSwitch locale={locale} onChange={chooseLocale} />
      </div>
      <main ref={mainRef} tabIndex={-1} className="app">
        {screen === 'intro' && <Intro caseData={caseData} onStart={() => dispatch({ type: 'start' })} />}
        {screen === 'board' && <Board caseData={caseData} state={state} dispatch={dispatch} onRestart={restart} />}
        {screen === 'result' && <Result caseData={caseData} state={state} onRestart={restart} />}
      </main>
    </UiContext.Provider>
  );
}
