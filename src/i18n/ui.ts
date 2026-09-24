import { createContext, useContext } from 'react';
import type { Locale } from './locale';

// Interface text (everything that is not case content). Case text lives in src/cases/<case>/<locale>.ts.
// Both languages implement the same interface, so a missing key is a type error.

export interface UiStrings {
  languageGroupLabel: string;
  /** Wraps quoted speech in the language's quotation marks. */
  quote: (text: string) => string;
  caseLabel: string;
  boardEyebrow: string;
  intro: { yourQuestion: string; timeNote: string; begin: string };
  board: { question: string; restart: string; sectionsLabel: string };
  tabs: { evidence: string; suspects: string; hints: string; deduce: string };
  placeholder: { tag: string; ariaLabel: (label: string) => string };
  evidence: { examined: string; notExamined: string; found: string; close: string; choose: string };
  suspects: {
    instructions: string;
    challenge: string;
    compareWith: string;
    choosePlaceholder: string;
    compare: string;
    cancel: string;
    examineFirst: string;
    contradiction: string;
    found: string;
    loggedAbove: string;
  };
  hints: { intro: string; label: (n: number) => string; reveal: (n: number, total: number) => string; none: string };
  deduction: {
    instructions: string;
    unexamined: (n: number) => string;
    submit: string;
    incomplete: string;
  };
  result: {
    eyebrow: string;
    solved: string;
    notQuite: string;
    solvedTagline: string;
    notQuiteTagline: string;
    youSaid: string;
    answer: string;
    correct: string;
    incorrect: string;
    stats: (s: { hints: string; evidence: string; contradictions: string }) => string;
    restart: string;
  };
  confirm: { restart: string; submit: string };
}

const ruPlural = new Intl.PluralRules('ru');
/** Russian noun forms: one (1, 21), few (2–4, 22–24), many (5–20, 25…). */
function ru3(n: number, one: string, few: string, many: string): string {
  const form = ruPlural.select(n);
  return form === 'one' ? one : form === 'few' ? few : many;
}

const en: UiStrings = {
  languageGroupLabel: 'Language / Язык',
  quote: (t) => `“${t}”`,
  caseLabel: 'Case 01',
  boardEyebrow: 'Hotel Vesper · Case 01',
  intro: {
    yourQuestion: 'Your question',
    timeNote:
      'About 5–10 minutes. No timer. Everything you need is in the evidence. Progress saves automatically in this browser.',
    begin: 'Begin the investigation',
  },
  board: { question: 'Question:', restart: 'Restart', sectionsLabel: 'Case sections' },
  tabs: { evidence: 'Evidence', suspects: 'Suspects', hints: 'Hints', deduce: 'Deduce' },
  placeholder: { tag: 'Placeholder art', ariaLabel: (label) => `Placeholder art: ${label}` },
  evidence: {
    examined: 'Examined',
    notExamined: 'Not yet examined',
    found: 'Found:',
    close: 'Close',
    choose: 'Choose an item to examine it closely.',
  },
  suspects: {
    instructions:
      'Challenge a statement with evidence you have examined. If a record proves the statement false, it is logged as a contradiction.',
    challenge: 'Challenge this statement',
    compareWith: 'Compare with:',
    choosePlaceholder: 'Choose examined evidence…',
    compare: 'Compare',
    cancel: 'Cancel',
    examineFirst: 'Examine some evidence first.',
    contradiction: 'Contradiction:',
    found: 'Contradiction found.',
    loggedAbove: 'Logged above.',
  },
  hints: {
    intro: 'Hints get more direct as you go. Reveal only as many as you need.',
    label: (n) => `Hint ${n}`,
    reveal: (n, total) => `Reveal hint ${n} of ${total}`,
    none: 'No more hints. The answer is in the evidence.',
  },
  deduction: {
    instructions: 'Answer all three parts, then submit. You get one verdict, and the full explanation follows.',
    unexamined: (n) => `You have ${n} unexamined item${n === 1 ? '' : 's'} of evidence.`,
    submit: 'Submit deduction',
    incomplete: 'Choose an answer for every part to submit.',
  },
  result: {
    eyebrow: 'Case 01 · Verdict',
    solved: 'Case solved.',
    notQuite: 'Not quite.',
    solvedTagline: 'Your reasoning holds. Every piece of evidence fits.',
    notQuiteTagline: 'Part of your answer does not fit the evidence. Here is what really happened.',
    youSaid: 'You said:',
    answer: 'Answer:',
    correct: '(correct)',
    incorrect: '(incorrect)',
    stats: (s) => `Hints used: ${s.hints} · Evidence examined: ${s.evidence} · Contradictions found: ${s.contradictions}`,
    restart: 'Restart the case',
  },
  confirm: {
    restart: 'Restart the case? Your notes, hints and answers will be cleared.',
    submit: 'Submit your deduction? This closes the case and reveals the solution.',
  },
};

const ru: UiStrings = {
  languageGroupLabel: 'Language / Язык',
  quote: (t) => `«${t}»`,
  caseLabel: 'Дело 01',
  boardEyebrow: 'Отель «Веспер» · Дело 01',
  intro: {
    yourQuestion: 'Ваш вопрос',
    timeNote:
      'Около 5–10 минут. Без таймера. Всё, что нужно, есть в уликах. Прогресс сохраняется в этом браузере автоматически.',
    begin: 'Начать расследование',
  },
  board: { question: 'Вопрос:', restart: 'Начать заново', sectionsLabel: 'Разделы дела' },
  tabs: { evidence: 'Улики', suspects: 'Подозреваемые', hints: 'Подсказки', deduce: 'Вывод' },
  placeholder: { tag: 'Временная иллюстрация', ariaLabel: (label) => `Временная иллюстрация: ${label}` },
  evidence: {
    examined: 'Изучено',
    notExamined: 'Ещё не изучено',
    found: 'Где найдено:',
    close: 'Закрыть',
    choose: 'Выберите улику, чтобы изучить её внимательнее.',
  },
  suspects: {
    instructions:
      'Оспорьте показание с помощью изученной улики. Если запись доказывает, что показание ложно, противоречие будет занесено в дело.',
    challenge: 'Оспорить показание',
    compareWith: 'Сравнить с:',
    choosePlaceholder: 'Выберите изученную улику…',
    compare: 'Сравнить',
    cancel: 'Отмена',
    examineFirst: 'Сначала изучите хотя бы одну улику.',
    contradiction: 'Противоречие:',
    found: 'Противоречие найдено.',
    loggedAbove: 'Оно занесено в дело выше.',
  },
  hints: {
    intro: 'С каждой подсказкой намёки всё прямее. Открывайте ровно столько, сколько нужно.',
    label: (n) => `Подсказка ${n}`,
    reveal: (n, total) => `Открыть подсказку ${n} из ${total}`,
    none: 'Подсказок больше нет. Ответ — в уликах.',
  },
  deduction: {
    instructions: 'Ответьте на все три вопроса и отправьте вывод. Вердикт будет один, а за ним — полное объяснение.',
    unexamined: (n) => `${ru3(n, 'Осталась', 'Остались', 'Осталось')} ${n} ${ru3(n, 'неизученная улика', 'неизученные улики', 'неизученных улик')}.`,
    submit: 'Отправить вывод',
    incomplete: 'Чтобы отправить вывод, ответьте на каждый вопрос.',
  },
  result: {
    eyebrow: 'Дело 01 · Вердикт',
    solved: 'Дело раскрыто.',
    notQuite: 'Не совсем.',
    solvedTagline: 'Ваши рассуждения безупречны. Все улики сходятся.',
    notQuiteTagline: 'Часть вашего ответа не сходится с уликами. Вот что произошло на самом деле.',
    youSaid: 'Ваш ответ:',
    answer: 'Верный ответ:',
    correct: '(верно)',
    incorrect: '(неверно)',
    stats: (s) =>
      `Подсказок использовано: ${s.hints} · Улик изучено: ${s.evidence} · Противоречий найдено: ${s.contradictions}`,
    restart: 'Начать дело заново',
  },
  confirm: {
    restart: 'Начать дело заново? Ваши находки, подсказки и ответы будут стёрты.',
    submit: 'Отправить вывод? Дело будет закрыто, и вы увидите разгадку.',
  },
};

export const uiStrings: Record<Locale, UiStrings> = { en, ru };

export const UiContext = createContext<UiStrings>(en);
export const useUi = () => useContext(UiContext);
