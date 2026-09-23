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

test('renders embedded ASS subtitles with libass and toggles them', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder(/https:/).fill('http://localhost:4173/samples/sample-subs.mkv');
  await page.getByRole('button', { name: 'Load URL' }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // Subtitle track is listed with its name and language.
  await page.getByRole('button', { name: 'Subtitles (c)' }).click();
  await expect(page.getByRole('menuitemradio', { name: /Русские \(ASS\) · RUS/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Subtitles (c)' }).click(); // close the menu
  await expect(page.getByRole('menu', { name: 'Subtitles' })).toBeHidden();

  // Seek (paused) into a range where two events are on screen, let libass paint.
  await page.keyboard.press('2'); // 2.4s
  await page.waitForTimeout(2500);
  // Compare only the top band where the "Sign" style renders: the video is
  // paused, so any difference there is the subtitle itself (not UI state).
  const box = (await page.locator('.aspect-video').first().boundingBox())!;
  const band = { x: box.x + box.width * 0.2, y: box.y + 4, width: box.width * 0.6, height: box.height * 0.12 };
  const withSubs = await page.screenshot({ clip: band });

  // Toggling shows a notice toast in the same area: wait for it to go away.
  await page.keyboard.press('c'); // -> off
  await expect(page.getByText('Subtitles off')).toBeHidden({ timeout: 6_000 });
  const without = await page.screenshot({ clip: band });
  const control = await page.screenshot({ clip: band });
  expect(Buffer.compare(without, control)).toBe(0); // the band is stable without subtitles
  expect(Buffer.compare(withSubs, without)).not.toBe(0);

  await page.keyboard.press('c'); // -> track again
  await expect(page.getByText(/Русские \(ASS\)/)).toBeHidden({ timeout: 6_000 });
  await page.waitForTimeout(500);
  const again = await page.screenshot({ clip: band });
  expect(Buffer.compare(again, without)).not.toBe(0);
});

test('loads an external SRT file dropped on the player', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder(/https:/).fill('http://localhost:4173/samples/sample-vp9-opus.mkv');
  await page.getByRole('button', { name: 'Load URL' }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible({ timeout: 15_000 });
  const srt = '1\n00:00:00,000 --> 00:00:10,000\nExternal <i>SRT</i> works\n';
  const dt = await page.evaluateHandle((text) => {
    const d = new DataTransfer();
    d.items.add(new File([text], 'episode.srt', { type: 'text/plain' }));
    return d;
  }, srt);
  await page.locator('.aspect-video').first().dispatchEvent('drop', { dataTransfer: dt });
  await expect(page.getByText('Subtitles: episode.srt')).toBeVisible();
  await page.getByRole('button', { name: 'Subtitles (c)' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'episode.srt' })).toHaveAttribute('aria-checked', 'true');
});
