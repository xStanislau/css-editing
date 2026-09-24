import { useEffect, useReducer, useRef } from 'react';
import type { CaseData } from './engine/types';
import { browserStore, clearProgress, loadProgress, saveProgress } from './engine/progress';
import { reduce, type Action } from './engine/reducer';
import { Intro } from './components/Intro';
import { Board } from './components/Board';
import { Result } from './components/Result';

export function App({ caseData }: { caseData: CaseData }) {
  const store = useRef(browserStore()).current;
  const [state, dispatch] = useReducer(
    (s: ReturnType<typeof loadProgress>, a: Action) => reduce(caseData, s, a),
    null,
    () => loadProgress(caseData, store),
  );

  useEffect(() => {
    saveProgress(caseData, state, store);
  }, [caseData, state, store]);

  const restart = () => {
    if (!window.confirm('Restart the case? Your notes, hints and answers will be cleared.')) return;
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
    <main ref={mainRef} tabIndex={-1} className="app">
      {screen === 'intro' && <Intro caseData={caseData} onStart={() => dispatch({ type: 'start' })} />}
      {screen === 'board' && <Board caseData={caseData} state={state} dispatch={dispatch} onRestart={restart} />}
      {screen === 'result' && <Result caseData={caseData} state={state} onRestart={restart} />}
    </main>
  );
}
