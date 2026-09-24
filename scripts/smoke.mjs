// Browser smoke test (optional, not a project dependency):
//   npm run build && npx vite preview --port 4173 --strictPort &
//   npm i --no-save playwright-core && CHROME_PATH=/path/to/chrome node scripts/smoke.mjs
// Full-flow smoke test: start → inspect evidence → contradiction → hint → deduce → explanation → restart,
// in English, then in Russian with mid-game language switching, localized dialogs and narrow-width layout checks.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
const OUT = new URL('../smoke-shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => {
  if (!c) throw new Error('ASSERT FAILED: ' + m);
  log(m);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const errors = [];

for (const vp of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 375, height: 740 }]) {
  console.log(`\n=== ${vp.name} ===`);
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${vp.name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${vp.name} console: ${m.text()}`));
  page.on('dialog', (d) => d.accept());

  await page.goto(APP);
  await page.screenshot({ path: `${OUT}${vp.name}-1-intro.png`, fullPage: true });
  assert(await page.getByRole('heading', { name: 'The Last Guest at Hotel Vesper' }).isVisible(), 'intro visible');

  // Keyboard start: button is autofocused
  await page.keyboard.press('Enter');
  assert(await page.getByRole('tab', { name: /Evidence/ }).isVisible(), 'board visible after Enter');

  // Examine all evidence
  for (const name of ['Folded note', 'Guest register', 'Shoe-polishing list', 'Groundsman’s notice', 'Generator logbook', 'Julian’s pocket notebook']) {
    await page.getByRole('button', { name: new RegExp(name) }).click();
  }
  assert(await page.getByRole('tab', { name: /Evidence 6\/6/ }).isVisible(), 'all 6 evidence examined');
  await page.getByRole('button', { name: /Shoe-polishing list/ }).click();
  await page.screenshot({ path: `${OUT}${vp.name}-2-evidence.png`, fullPage: true });

  // Tabs via keyboard arrows
  await page.getByRole('tab', { name: /Evidence/ }).focus();
  await page.keyboard.press('ArrowRight');
  assert(await page.getByRole('tab', { name: /Suspects/ }).getAttribute('aria-selected') === 'true', 'arrow key moves to Suspects tab');

  // Wrong challenge
  const felixClaim = page.locator('li.claim', { hasText: 'read in the library' });
  await felixClaim.getByRole('button', { name: 'Challenge this statement' }).click();
  await felixClaim.getByLabel('Compare with:').selectOption({ label: 'Shoe-polishing list' });
  await felixClaim.getByRole('button', { name: 'Compare' }).click();
  assert(await felixClaim.getByText(/Nothing here proves/).isVisible(), 'non-contradiction feedback shown');

  // Key contradiction
  const ruthClaim = page.locator('li.claim', { hasText: 'set foot outside' });
  await ruthClaim.getByRole('button', { name: 'Challenge this statement' }).click();
  await ruthClaim.getByLabel('Compare with:').selectOption({ label: 'Shoe-polishing list' });
  await ruthClaim.getByRole('button', { name: 'Compare' }).click();
  assert(await ruthClaim.getByText('Contradiction found.').isVisible(), 'Ruth contradiction found');
  await page.screenshot({ path: `${OUT}${vp.name}-3-suspects.png`, fullPage: true });

  // Hint
  await page.getByRole('tab', { name: /Hints/ }).click();
  await page.getByRole('button', { name: 'Reveal hint 1 of 3' }).click();
  assert(await page.getByText('Hint 1').isVisible(), 'hint 1 revealed');

  // Reload: progress persists
  await page.reload();
  assert(await page.getByRole('tab', { name: /Evidence 6\/6/ }).isVisible(), 'progress persisted after reload (evidence)');
  assert(await page.getByRole('tab', { name: /Hints 1\/3/ }).isVisible(), 'progress persisted after reload (hints)');

  // Deduce
  await page.getByRole('tab', { name: /Deduce/ }).click();
  const submit = page.getByRole('button', { name: 'Submit deduction' });
  assert(await submit.isDisabled(), 'submit disabled until complete');
  await page.getByLabel('Bolted in the wine store').check();
  await page.getByLabel('Ruth Calloway').check();
  await page.getByLabel('Shoe-polishing list').check();
  await page.screenshot({ path: `${OUT}${vp.name}-4-deduce.png`, fullPage: true });
  await submit.click();
  assert(await page.getByRole('heading', { name: 'Case solved.' }).isVisible(), 'correct verdict shown');
  assert(await page.getByText('Ruth Calloway bolted Julian Marsh in the wine store.').isVisible(), 'explanation shown');
  await page.screenshot({ path: `${OUT}${vp.name}-5-result.png`, fullPage: true });

  // Result persists on reload
  await page.reload();
  assert(await page.getByRole('heading', { name: 'Case solved.' }).isVisible(), 'result persisted after reload');

  // Horizontal overflow check
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, 'no horizontal overflow');

  // Restart
  await page.getByRole('button', { name: 'Restart the case' }).click();
  assert(await page.getByRole('button', { name: 'Begin the investigation' }).isVisible(), 'restart returns to intro');
  await page.getByRole('button', { name: 'Begin the investigation' }).click();
  assert(await page.getByRole('tab', { name: /Evidence 0\/6/ }).isVisible(), 'restart cleared evidence');

  // Wrong answer path
  await page.getByRole('tab', { name: /Deduce/ }).click();
  await page.getByLabel('Bolted in the wine store').check();
  await page.getByLabel('Dr Felix Arden').check();
  await page.getByLabel('Folded note').check();
  await page.getByRole('button', { name: 'Submit deduction' }).click();
  assert(await page.getByRole('heading', { name: 'Not quite.' }).isVisible(), 'wrong verdict shown');
  assert(await page.getByText('Answer: Ruth Calloway').isVisible(), 'correct answer revealed for wrong part');

  // Malformed save
  await page.evaluate(() => localStorage.setItem('vesper:case-01-vesper:progress', '{broken'));
  await page.reload();
  assert(await page.getByRole('button', { name: 'Begin the investigation' }).isVisible(), 'malformed save falls back to fresh intro');

  await ctx.close();
}

// ---------------------------------------------------------------- Russian
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const tabsFit = (page) => page.locator('.tabs').evaluate((el) => el.scrollWidth <= el.clientWidth);
// Visible Latin text in Russian mode, ignoring the "English" switch button.
const latinLeftovers = (page) =>
  page.evaluate(() => {
    const out = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const n = walk.currentNode;
      if (n.parentElement?.closest('[lang="en"]')) continue;
      if (/[A-Za-z]/.test(n.textContent)) out.push(n.textContent.trim());
    }
    for (const el of document.querySelectorAll('[aria-label]'))
      if (!el.closest('.lang-switch') && /[A-Za-z]/.test(el.getAttribute('aria-label'))) out.push('aria:' + el.getAttribute('aria-label'));
    return out;
  });

for (const vp of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 375, height: 740 }, { name: 'narrow', width: 320, height: 640 }]) {
  console.log(`\n=== Russian ${vp.name} ===`);
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('pageerror', (e) => errors.push(`ru ${vp.name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`ru ${vp.name} console: ${m.text()}`));
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    d.accept();
  });
  const shot = (n) => page.screenshot({ path: `${OUT}ru-${vp.name}-${n}.png`, fullPage: true });
  const checkScreen = async (label) => {
    assert(await noOverflow(page), `${label}: no horizontal overflow`);
    const latin = await latinLeftovers(page);
    assert(latin.length === 0, `${label}: no untranslated Latin text${latin.length ? ' → ' + JSON.stringify(latin) : ''}`);
  };

  await page.goto(APP);
  assert(await page.getByRole('heading', { name: 'Последний гость отеля «Веспер»' }).isVisible(), 'Russian browser → Russian intro');
  assert((await page.evaluate(() => document.documentElement.lang)) === 'ru', 'html lang=ru');
  assert((await page.title()) === 'Последний гость отеля «Веспер»', 'document title localized');
  assert(await page.getByRole('button', { name: 'Русский' }).getAttribute('aria-pressed') === 'true', 'switch shows Русский selected');
  await checkScreen('intro');
  await shot('1-intro');

  await page.getByRole('button', { name: 'Начать расследование' }).click();
  assert(await page.getByRole('tab', { name: /Улики 0\/6/ }).isVisible(), 'board in Russian');
  assert(await tabsFit(page), 'Russian tabs fit without scrolling');
  for (const name of ['Сложенная записка', 'Книга регистрации гостей', 'Список обуви в чистку', 'Объявление садовника', 'Журнал генератора', 'Записная книжка Джулиана']) {
    await page.getByRole('button', { name: new RegExp(name) }).click();
  }
  assert(await page.getByRole('tab', { name: /Улики 6\/6/ }).isVisible(), 'all 6 evidence examined (ru)');
  await page.getByRole('button', { name: /Журнал генератора/ }).click();
  assert(await page.getByText('23:34 — на месте О. Вэнс.', { exact: false }).isVisible(), 'generator log uses 24-hour time');
  await checkScreen('evidence');
  await shot('2-evidence');

  await page.getByRole('tab', { name: /Подозреваемые/ }).click();
  const ruth = page.locator('li.claim', { hasText: 'ни разу не выходила на улицу' });
  await ruth.getByRole('button', { name: 'Оспорить показание' }).click();
  await ruth.getByLabel('Сравнить с:').selectOption({ label: 'Список обуви в чистку' });
  await ruth.getByRole('button', { name: 'Сравнить' }).click();
  assert(await ruth.getByText('Противоречие найдено.').isVisible(), 'Russian contradiction found');
  await checkScreen('suspects');
  await shot('3-suspects');

  // Switch to English mid-game: progress and open UI state survive, text changes.
  await page.getByRole('button', { name: 'English' }).click();
  assert((await page.evaluate(() => document.documentElement.lang)) === 'en', 'html lang=en after switch');
  assert(await page.getByRole('tab', { name: /Evidence 6\/6/ }).isVisible(), 'progress kept after switching to English');
  assert(await page.getByRole('tab', { name: /Suspects/ }).getAttribute('aria-selected') === 'true', 'current tab kept after switch');
  assert(await page.locator('li.claim', { hasText: 'set foot outside' }).getByText('Contradiction found.').isVisible(), 'feedback re-rendered in English');
  await page.getByRole('button', { name: 'Русский' }).click();
  assert(await page.getByRole('tab', { name: /Подозреваемые 1/ }).isVisible(), 'switched back to Russian with contradiction kept');

  await page.getByRole('tab', { name: /Подсказки/ }).click();
  await page.getByRole('button', { name: 'Открыть подсказку 1 из 3' }).click();
  assert(await page.getByText('Подсказка 1').isVisible(), 'Russian hint revealed');
  await checkScreen('hints');

  await page.reload();
  assert(await page.getByRole('tab', { name: /Подсказки 1\/3/ }).isVisible(), 'Russian progress survives reload');

  await page.getByRole('tab', { name: /Вывод/ }).click();
  await page.getByLabel('Заперт на засов в винной кладовой').check();
  await page.getByLabel('Рут Кэллоуэй').check();
  // Language switch while answers are half-entered keeps them.
  await page.getByRole('button', { name: 'English' }).click();
  assert(await page.getByLabel('Ruth Calloway').isChecked(), 'answers kept across switch');
  await page.getByRole('button', { name: 'Русский' }).click();
  await page.getByLabel('Список обуви в чистку').check();
  await checkScreen('deduce');
  await shot('4-deduce');
  await page.getByRole('button', { name: 'Отправить вывод' }).click();
  assert(dialogs.at(-1) === 'Отправить вывод? Дело будет закрыто, и вы увидите разгадку.', 'submit confirm localized');
  assert(await page.getByRole('heading', { name: 'Дело раскрыто.' }).isVisible(), 'Russian correct verdict');
  assert(await page.getByText('Рут Кэллоуэй заперла Джулиана Марша в винной кладовой.').isVisible(), 'Russian explanation');
  await checkScreen('result');
  await shot('5-result');

  await page.getByRole('button', { name: 'English' }).click();
  assert(await page.getByRole('heading', { name: 'Case solved.' }).isVisible(), 'result screen switches language');
  await page.reload();
  assert(await page.getByRole('heading', { name: 'Case solved.' }).isVisible(), 'explicit English choice remembered over Russian browser');
  await page.getByRole('button', { name: 'Русский' }).click();

  await page.getByRole('button', { name: 'Начать дело заново' }).click();
  assert(dialogs.at(-1) === 'Начать дело заново? Ваши находки, подсказки и ответы будут стёрты.', 'restart confirm localized');
  assert(await page.getByRole('button', { name: 'Начать расследование' }).isVisible(), 'Russian restart returns to intro');
  await page.getByRole('button', { name: 'Начать расследование' }).click();
  assert(await page.getByRole('tab', { name: /Улики 0\/6/ }).isVisible(), 'restart cleared progress (ru)');

  await ctx.close();
}

// English-only save from before localization still loads.
{
  console.log('\n=== legacy save ===');
  const ctx = await browser.newContext({ locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto(APP);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      'vesper:case-01-vesper:progress',
      '{"version":1,"caseId":"case-01-vesper","started":true,"examined":["note","shoes"],"hintsUsed":2,"contradictionsFound":["ruth-outside|shoes"],"answers":{"where":"wine-store"},"submitted":false}',
    );
  });
  await page.reload();
  assert(await page.getByRole('tab', { name: /Evidence 2\/6/ }).isVisible(), 'legacy English save loads');
  await page.getByRole('button', { name: 'Русский' }).click();
  assert(await page.getByRole('tab', { name: /Подсказки 2\/3/ }).isVisible(), 'legacy save shown in Russian');
  await ctx.close();
}

await browser.close();
if (errors.length) {
  console.error('\nPage errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\nAll browser checks passed.');
