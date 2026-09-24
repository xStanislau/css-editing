// Browser smoke test (optional, not a project dependency):
//   npm run build && npx vite preview --port 4173 --strictPort &
//   npm i --no-save playwright-core && CHROME_PATH=/path/to/chrome node scripts/smoke.mjs
// Full-flow smoke test: start → inspect evidence → contradiction → hint → deduce → explanation → restart.
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
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
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

await browser.close();
if (errors.length) {
  console.error('\nPage errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\nAll browser checks passed.');
