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
