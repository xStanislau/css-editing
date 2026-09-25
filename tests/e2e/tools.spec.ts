import { expect, test, type Page } from '@playwright/test';

const SAMPLE = 'http://localhost:4173/samples/sample-vp9-opus.mp4';

async function clockSeconds(page: Page): Promise<number> {
  const text = (await page.locator('span.font-mono.tabular-nums').textContent()) ?? '';
  const [m, s] = text.split('/')[0].trim().split(':').map(Number);
  return m * 60 + s;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder(/https:/).fill(SAMPLE);
  await page.getByRole('button', { name: 'Load URL' }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible({ timeout: 15_000 });
});

test('A-B loop keeps playback inside the range', async ({ page }) => {
  await page.keyboard.press('1'); // 1.2s
  await page.keyboard.press('b'); // A
  await page.keyboard.press('3'); // 3.6s
  await page.keyboard.press('b'); // B
  await expect(page.getByRole('button', { name: 'Clear loop (b)' })).toBeVisible();
  await page.keyboard.press('1');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  // Longer than the loop: without looping the clock would pass 5s.
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(500);
    expect(await clockSeconds(page)).toBeLessThanOrEqual(4);
  }
});

test('frame stepping pauses and moves by single frames', async ({ page }) => {
  await page.keyboard.press('5'); // 6.0s, paused
  await page.keyboard.press('s');
  for (let i = 0; i < 15; i++) await page.keyboard.press('.');
  await page.waitForTimeout(1500);
  // 15 frames at 30fps = 0.5s, well below the next whole second.
  expect(await clockSeconds(page)).toBe(6);
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible();
});

test('picture panel and zoom controls', async ({ page }) => {
  await page.getByRole('button', { name: 'Picture settings' }).click();
  await expect(page.getByText('Brightness')).toBeVisible();
  await page.keyboard.press('+');
  await expect(page.getByRole('button', { name: /1\.3× · reset/ })).toBeVisible();
  await page.keyboard.press('z');
  await expect(page.getByRole('button', { name: /× · reset/ })).toHaveCount(0);
});

test('seek bar hover shows a real decoded frame', async ({ page }) => {
  const bar = page.getByRole('slider', { name: 'Seek' });
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  const preview = page.locator('canvas[data-ready]');
  await expect(preview).toBeVisible({ timeout: 5_000 });
  // The preview canvas must contain actual picture content, not a blank box.
  const lit = await preview.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return sum / (d.length / 4) / 3;
  });
  expect(lit).toBeGreaterThan(40);
});

test('Anime4K: E enables the chain; low-res video is upscaled 2x on the GPU', async ({ page }) => {
  await page.getByPlaceholder(/https:/).fill('http://localhost:4173/samples/sample-lineart-270p.mkv');
  await page.getByRole('button', { name: 'Load URL' }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('s');
  await page.keyboard.press('e'); // default preset: Balanced (Upscale CNN M)
  const stats = page.locator('pre');
  await expect(stats).toContainText('Anime4K balanced · 2× upscale · 9 compute passes', { timeout: 20_000 });
  await expect(stats).toContainText('480×270 → 960×540');
  await page.keyboard.press('e'); // back to zero-copy
  await expect(stats).toContainText('WebGPU zero-copy external texture');
});

test('Anime4K: chains stay compiled, so switching back is instant', async ({ page }) => {
  await page.getByPlaceholder(/https:/).fill('http://localhost:4173/samples/sample-lineart-270p.mkv');
  await page.getByRole('button', { name: 'Load URL' }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('s');
  const stats = page.locator('pre');
  await page.getByRole('button', { name: 'Anime4K (e)' }).click();
  await page.getByRole('menuitemradio', { name: /Quality/ }).click();
  await expect(stats).toContainText('Anime4K quality', { timeout: 30_000 });
  await page.getByRole('menuitemradio', { name: /Balanced/ }).click();
  await expect(stats).toContainText('Anime4K balanced · 2× upscale', { timeout: 30_000 });
  // Back to Quality: served from the cache, never shows "compiling".
  await page.getByRole('menuitemradio', { name: /Quality/ }).click();
  await expect(page.getByRole('menu', { name: 'Anime4K' })).not.toContainText('compiling');
  await expect(stats).toContainText('Anime4K quality', { timeout: 3_000 });
});

test('Compare: V shows original | Anime4K with a draggable divider', async ({ page }) => {
  await page.getByPlaceholder(/https:/).fill('http://localhost:4173/samples/sample-lineart-270p.mkv');
  await page.getByRole('button', { name: 'Load URL' }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('v');
  const divider = page.getByRole('slider', { name: 'Compare split' });
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  await expect(page.getByRole('button', { name: 'Anime4K (e)' })).toHaveText(/BALANCED/);
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(Number(await divider.getAttribute('aria-valuenow'))).toBeLessThan(40);
  // Dragging the divider must not toggle playback.
  await expect(page.getByRole('button', { name: 'Play (k)' })).toBeVisible();
  // Turning Anime4K off ends the comparison.
  await page.keyboard.press('e');
  await expect(divider).toBeHidden();
});
