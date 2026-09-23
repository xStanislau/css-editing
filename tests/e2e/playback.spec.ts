import { expect, test, type Page } from '@playwright/test';

const SAMPLE = '/samples/sample-vp9-opus.mp4';

/** Seconds shown by the player's clock ("0:07 / 0:12" -> 7). */
async function currentSeconds(page: Page): Promise<number> {
  const text = (await page.locator('span.font-mono.tabular-nums').textContent()) ?? '';
  const [m, s] = text.split('/')[0].trim().split(':').map(Number);
  return m * 60 + s;
}

async function loadSample(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder(/https:/).fill(new URL(SAMPLE, 'http://localhost:4173').href);
  await page.getByRole('button', { name: 'Load URL' }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

test('page is cross-origin isolated (required for SharedArrayBuffer)', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
});

test('plays, keeps A/V in sync, seeks and reaches the end', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loadSample(page);

  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect.poll(() => currentSeconds(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

  // Stats overlay: A/V offset must stay within ±40ms (about one frame at 25fps).
  await page.keyboard.press('s');
  const stats = page.locator('pre');
  await expect(stats).toContainText('A/V offset');
  const offset = Number((await stats.textContent())!.match(/A\/V offset\s+([+-][\d.]+)/)![1]);
  expect(Math.abs(offset)).toBeLessThan(40);

  // Seek to 50% with the number key.
  await page.keyboard.press('5');
  await expect.poll(() => currentSeconds(page), { timeout: 5_000 }).toBeGreaterThanOrEqual(6);

  await expect(page.getByRole('button', { name: 'Replay' }).first()).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

test('reports unsupported media instead of failing silently', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder(/https:/).fill('http://localhost:4173/index.html');
  await page.getByRole('button', { name: 'Load URL' }).click();
  await expect(page.locator('.bg-red-950\\/90')).toBeVisible({ timeout: 15_000 });
});

test('plays Matroska (MKV) and seeks through its Cues', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder(/https:/).fill('http://localhost:4173/samples/sample-vp9-opus.mkv');
  await page.getByRole('button', { name: 'Load URL' }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect.poll(() => currentSeconds(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('7');
  await expect.poll(() => currentSeconds(page), { timeout: 5_000 }).toBeGreaterThanOrEqual(8);
  await expect(page.getByRole('button', { name: 'Replay' }).first()).toBeVisible({ timeout: 20_000 });
});
