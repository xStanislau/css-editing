import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** GPU quality tests: run the real render modules in a Vite dev page (npm run test:gpu). */
export default defineConfig({
  ...base,
  testDir: 'tests/gpu',
  use: { ...base.use, baseURL: 'http://localhost:5174' },
  webServer: { command: 'npx vite --port 5174 --strictPort', url: 'http://localhost:5174/tests/gpu/anime4k.html', reuseExistingServer: false, timeout: 60_000 },
});
