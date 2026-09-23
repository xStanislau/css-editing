import { defineConfig, devices } from '@playwright/test';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * End-to-end tests against the production build.
 * For meaningful render numbers run on a machine with a real GPU. Without one
 * (headless CI), WebGPU runs on SwiftShader's Vulkan driver, which ships next
 * to the Chromium binary: slow, but real rendering.
 * Set CHROMIUM_PATH to use a preinstalled Chromium instead of a downloaded one.
 */
const chromium = process.env.CHROMIUM_PATH;
const swiftshaderIcd = chromium && join(dirname(chromium), 'vk_swiftshader_icd.json');
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  // GPU-heavy: parallel browsers would compete for the same GPU and skew timing.
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      executablePath: chromium || undefined,
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--use-vulkan=swiftshader',
        '--use-angle=swiftshader',
        '--use-webgpu-adapter=swiftshader',
        '--autoplay-policy=no-user-gesture-required',
      ],
      env: swiftshaderIcd && existsSync(swiftshaderIcd) ? { ...process.env, VK_ICD_FILENAMES: swiftshaderIcd } : undefined,
    },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    // Always test a fresh build (a stale preview server would test old code).
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
