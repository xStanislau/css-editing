import { writeFileSync, mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const BASE = 'http://localhost:4173';
const MP4 = `${BASE}/samples/sample-vp9-opus.mp4`;
const MKV = `${BASE}/samples/sample-vp9-opus.mkv`;

type Row = { metric: string; value: number | string; unit: string; target?: string; ok?: boolean };
const rows: Row[] = [];
const record = (metric: string, value: number | string, unit: string, target?: string, ok?: boolean) =>
  rows.push({ metric, value: typeof value === 'number' ? Math.round(value * 10) / 10 : value, unit, target, ok });

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? NaN;
const p95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.95))] ?? NaN;

test.describe.configure({ mode: 'serial' });

/** Collect page errors and VideoFrame-leak warnings (worker console messages surface on the page). */
function watch(page: Page) {
  const errors: string[] = [];
  const leaks: string[] = [];
  const onConsole = (text: string) => {
    if (/garbage collected|without being closed|without having been closed/i.test(text)) leaks.push(text);
  };
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => onConsole(m.text()));
  return { errors, leaks };
}

async function load(page: Page, url: string) {
  await page.getByPlaceholder(/https:/).fill(url);
  await page.getByRole('button', { name: 'Load URL' }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible({ timeout: 20_000 });
}

const measures = (page: Page, name: string) =>
  page.evaluate((n) => performance.getEntriesByName(n).map((e) => e.duration), name);

async function clock(page: Page): Promise<number> {
  const text = (await page.locator('span.font-mono.tabular-nums').textContent()) ?? '';
  const [m, s] = text.split('/')[0].trim().split(':').map(Number);
  return m * 60 + s;
}

test('page load', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('load');
  const fcp = await page.evaluate(
    () =>
      new Promise<number>((resolve) =>
        new PerformanceObserver((l) => {
          const e = l.getEntries().find((x) => x.name === 'first-contentful-paint');
          if (e) resolve(e.startTime);
        }).observe({ type: 'paint', buffered: true }),
      ),
  );
  const nav = await page.evaluate(() => {
    const scripts = performance
      .getEntriesByType('resource')
      .filter((e) => (e as PerformanceResourceTiming).initiatorType === 'script')
      .reduce((s, e) => s + (e as PerformanceResourceTiming).decodedBodySize, 0);
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return { dcl: n.domContentLoadedEventEnd, scripts };
  });
  // FCP == first paint thanks to the static HTML shell; the rest is raster time.
  record('First contentful paint', fcp, 'ms', '< 300', fcp < 300);
  record('DOMContentLoaded', nav.dcl, 'ms');
  record('Initial JS (decoded)', nav.scripts / 1024, 'KB');
});

test('time to first frame', async ({ page }) => {
  for (const [label, url] of [['MP4', MP4], ['MKV', MKV]] as const) {
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      await page.goto('/');
      await page.waitForTimeout(800); // GPU/worker init is page start-up, not TTFF
      await load(page, url);
      await expect.poll(async () => (await measures(page, 'prism:ttff')).length, { timeout: 10_000 }).toBeGreaterThan(0);
      samples.push((await measures(page, 'prism:ttff'))[0]);
    }
    record(`TTFF ${label} (median of 3)`, median(samples), 'ms', '< 500', median(samples) < 500);
  }
});

test('seek latency and seek-bar previews', async ({ page }) => {
  await page.goto('/');
  await load(page, MKV);
  await page.waitForTimeout(1500);

  // Seeks while paused, spread over the file.
  for (const key of ['7', '2', '9', '4', '1', '6', '3', '8', '5', '0', '7', '3']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(700);
  }
  const seeks = await measures(page, 'prism:seek');
  record('Seek → exact frame (median)', median(seeks), 'ms', '< 250', median(seeks) < 250);
  record('Seek → exact frame (p95)', p95(seeks), 'ms');
  record('Seeks answered', `${seeks.length}/12`, '');

  // Hover previews: cached positions (after a first pass warmed them up).
  const bar = (await page.getByRole('slider', { name: 'Seek' }).boundingBox())!;
  const y = bar.y + bar.height / 2;
  const hoverAt = async (f: number) => {
    await page.mouse.move(bar.x + bar.width * f, y);
    await page.waitForTimeout(350);
  };
  for (const f of [0.12, 0.37, 0.62, 0.88]) await hoverAt(f);
  await page.evaluate(() => performance.clearMeasures('prism:preview'));
  for (const f of [0.12, 0.37, 0.62, 0.88]) await hoverAt(f);
  const warm = await measures(page, 'prism:preview');
  record('Preview hover (cached, median)', median(warm), 'ms', '< 30', median(warm) < 30);

  // Click exactly where the user hovers: the preview decoder's frame shows at once.
  await hoverAt(0.62);
  await page.mouse.click(bar.x + bar.width * 0.62, y);
  await page.waitForTimeout(700);
  const inst = await measures(page, 'prism:seek-instant');
  const lastInstant = inst.length ? inst[inst.length - 1] : NaN;
  record('Click-seek → instant frame', lastInstant, 'ms', '< 50', lastInstant < 50);

  // Cold preview: first hover right after loading (nothing cached, network + decode).
  const cold: number[] = [];
  for (let i = 0; i < 3; i++) {
    await page.goto('/');
    await load(page, MKV);
    const b = (await page.getByRole('slider', { name: 'Seek' }).boundingBox())!;
    await page.mouse.move(b.x + b.width * (0.3 + i * 0.2), b.y + b.height / 2);
    await expect.poll(async () => (await measures(page, 'prism:preview')).length, { timeout: 5_000 }).toBeGreaterThan(0);
    cold.push((await measures(page, 'prism:preview'))[0]);
  }
  record('Preview hover (cold, median of 3)', median(cold), 'ms', '< 150', median(cold) < 150);
});

test('main thread during playback and input latency', async ({ page }) => {
  await page.goto('/');
  await load(page, MKV);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  await page.evaluate(() => {
    const w = window as unknown as { __long: number[]; __events: number[]; __handlers: number[]; __mutations: number };
    w.__long = [];
    w.__events = [];
    w.__handlers = [];
    w.__mutations = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ type: 'longtask', buffered: false });
    // Handler cost (processingEnd - processingStart) is ours; the full duration
    // also includes waiting for the compositor's next frame.
    new PerformanceObserver((l) =>
      l.getEntries().forEach((e) => {
        const t = e as PerformanceEventTiming;
        w.__events.push(t.duration);
        w.__handlers.push(t.processingEnd - t.processingStart);
      }),
    ).observe({
      type: 'event',
      durationThreshold: 0,
      buffered: false,
    } as PerformanceObserverInit);
    new MutationObserver((m) => (w.__mutations += m.length)).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });

  const metric = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return Object.fromEntries(metrics.map((m) => [m.name, m.value])) as Record<string, number>;
  };
  const before = await metric();
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();

  // Interact while playing: the UI must stay instant.
  for (const key of ['ArrowUp', 'ArrowDown', 'm', 'm', 's', 's', 'ArrowUp']) {
    await page.waitForTimeout(700);
    await page.keyboard.press(key);
  }
  await page.waitForTimeout(8000 - 7 * 700);
  const after = await metric();
  const wall = (Date.now() - t0) / 1000;

  const r = await page.evaluate(() => {
    const w = window as unknown as { __long: number[]; __events: number[]; __handlers: number[]; __mutations: number };
    return { long: w.__long, events: w.__events, handlers: w.__handlers, mutations: w.__mutations };
  });
  const busy = ((after.TaskDuration - before.TaskDuration) / wall) * 100;
  const tbt = r.long.reduce((s, d) => s + Math.max(0, d - 50), 0);
  record('Main-thread busy during playback', busy, '% of one core', '< 10', busy < 10);
  record('Long tasks (>50 ms) in 8 s', r.long.length, 'count', '0', r.long.length === 0);
  record('Total blocking time', tbt, 'ms', '< 50', tbt < 50);
  record('DOM mutations per second', r.mutations / wall, '/s');
  const handler = r.handlers.length ? Math.max(...r.handlers) : 0;
  record('Slowest input handler (our JS)', handler, 'ms', '< 16', handler < 16);
  record('Slowest input → next paint', r.events.length ? Math.max(...r.events) : 0, 'ms', 'compositor-bound');
  record('JS heap (main)', after.JSHeapUsedSize / 1048576, 'MB');
});

test('stress: rapid seeks and scrubbing', async ({ page }) => {
  const w = watch(page);
  await page.goto('/');
  await load(page, MKV);
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.waitForTimeout(1000);
  const keys = '7294163850'.split('');
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press(keys[i % keys.length]);
    await page.waitForTimeout(50);
  }
  // Scrub drag across the bar.
  const bar = (await page.getByRole('slider', { name: 'Seek' }).boundingBox())!;
  await page.mouse.move(bar.x + 5, bar.y + bar.height / 2);
  await page.mouse.down();
  for (let i = 0; i <= 30; i++) await page.mouse.move(bar.x + (bar.width * i) / 30, bar.y + bar.height / 2);
  await page.mouse.move(bar.x + bar.width * 0.2, bar.y + bar.height / 2);
  await page.mouse.up();
  // The drag ended at 20% (≈2.4 s): playback must continue from there.
  const start = Date.now();
  let recovered = false;
  while (Date.now() - start < 6000 && !recovered) {
    await page.waitForTimeout(250);
    recovered = (await clock(page)) >= 4;
  }
  record('Recovers after 40 seeks + scrub', recovered ? `yes (${Date.now() - start} ms)` : 'NO', '', 'yes', recovered);
  record('Page errors during stress', w.errors.length, 'count', '0', w.errors.length === 0);
});

test('stress: rapid source switching', async ({ page }) => {
  const w = watch(page);
  await page.goto('/');
  for (let i = 0; i < 6; i++) {
    await page.getByPlaceholder(/https:/).fill(i % 2 ? MP4 : MKV);
    await page.getByRole('button', { name: 'Load URL' }).click();
    await page.waitForTimeout(250);
  }
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect.poll(() => clock(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  record('Plays after 6 rapid loads', 'yes', '', 'yes', true);
  record('Page errors during switching', w.errors.length, 'count', '0', w.errors.length === 0);
});

test('memory: soak with A-B loop and forced GC', async ({ page }) => {
  const w = watch(page);
  await page.goto('/');
  await load(page, MKV);
  // Loop 1.2s..9.6s for ~40 s: thousands of frames decoded/closed.
  await page.keyboard.press('1');
  await page.keyboard.press('b');
  await page.keyboard.press('8');
  await page.waitForTimeout(400);
  await page.keyboard.press('b');
  await page.keyboard.press('1');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();

  const heap = async () => {
    await page.evaluate(() => (globalThis as unknown as { gc?: () => void }).gc?.());
    for (const wk of page.workers()) await wk.evaluate(() => (globalThis as unknown as { gc?: () => void }).gc?.()).catch(() => {});
    return page.evaluate(() => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576);
  };
  await page.waitForTimeout(5000);
  const start = await heap();
  await page.waitForTimeout(35000);
  const end = await heap();
  await page.waitForTimeout(1500); // let GC-triggered warnings print
  record('Main heap growth over 35 s loop', end - start, 'MB', '< 5', end - start < 5);
  record('VideoFrame leak warnings', w.leaks.length, 'count', '0', w.leaks.length === 0);
  record('Page errors during soak', w.errors.length, 'count', '0', w.errors.length === 0);
});

test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/perf-report.json', JSON.stringify(rows, null, 2));
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log('\n' + rows.map((r) => `${r.ok === undefined ? '  ' : r.ok ? '✓ ' : '✗ '}${pad(r.metric, 36)} ${pad(`${r.value} ${r.unit}`, 22)} ${r.target ? `target ${r.target}` : ''}`).join('\n'));
});
