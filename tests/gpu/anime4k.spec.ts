import { writeFileSync, mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Objective Anime4K check: 2x upscale of line art vs the ground truth.
 * Every preset must beat plain bilinear (the zero-copy path) by a clear
 * margin; a transpiler bug (weight order, depth-to-space parity...) would
 * produce garbage and fail this immediately.
 */
test('Anime4K presets beat bilinear on line art (PSNR vs ground truth)', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/tests/gpu/anime4k.html');
  await expect(page).toHaveTitle('ready');
  const results = await page.evaluate(() =>
    (window as unknown as { runAnime4K: (p: string[]) => Promise<Record<string, { psnr: number; ms: number; passes: number; png: string }>> }).runAnime4K([
      'fast',
      'balanced',
      'quality',
      'restore',
      'denoise',
    ]),
  );

  mkdirSync('test-results/anime4k', { recursive: true });
  const rows = Object.entries(results).map(([name, r]) => {
    writeFileSync(`test-results/anime4k/${name}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
    return { name, psnr: Math.round(r.psnr * 100) / 100, gain: Math.round((r.psnr - results.bilinear.psnr) * 100) / 100, passes: r.passes, ms: Math.round(r.ms) };
  });
  writeFileSync('test-results/anime4k/report.json', JSON.stringify(rows, null, 2));
  console.table(rows);

  for (const preset of ['fast', 'balanced', 'quality', 'restore', 'denoise']) {
    expect(results[preset].psnr, preset).toBeGreaterThan(results.bilinear.psnr + 2);
  }
  // Bigger networks must be better: S < M < VL.
  expect(results.balanced.psnr).toBeGreaterThan(results.fast.psnr);
  expect(results.quality.psnr).toBeGreaterThan(results.balanced.psnr);
});

/**
 * Numerical validation of the transpiled WGSL against an independent float32
 * CPU evaluation of the original GLSL (fp16 feature maps => ~1e-3 tolerance).
 */
test('transpiled WGSL matches a float32 CPU reference of the original GLSL', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/tests/gpu/anime4k.html');
  await expect(page).toHaveTitle('ready');
  for (const name of ['Restore_CNN_S', 'Restore_CNN_M', 'Restore_CNN_VL']) {
    const r = await page.evaluate((n) => (window as unknown as { compareWithReference: (n: string) => Promise<{ maxErr: number; meanErr: number }> }).compareWithReference(n), name);
    expect(r.maxErr, name).toBeLessThan(0.005);
    expect(r.meanErr, name).toBeLessThan(0.001);
  }
});
