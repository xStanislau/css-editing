import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Performance & responsiveness suite (npm run test:perf). Produces
 * test-results/perf-report.json and a readable table on stdout.
 * Numbers are only comparable on the same machine; without a GPU,
 * rendering FPS is meaningless but main-thread and latency numbers hold.
 */
export default defineConfig({
  ...base,
  testDir: 'tests/perf',
  timeout: 180_000,
  use: {
    ...base.use,
    launchOptions: {
      ...base.use?.launchOptions,
      args: [...(base.use?.launchOptions?.args ?? []), '--js-flags=--expose-gc', '--enable-precise-memory-info'],
    },
  },
});
