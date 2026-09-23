import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the production build.
 * For meaningful render numbers run on a machine with a real GPU; in headless
 * CI without one, Chromium falls back to SwiftShader (slow but functional).
 * Set CHROMIUM_PATH to use a preinstalled Chromium instead of a downloaded one.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
