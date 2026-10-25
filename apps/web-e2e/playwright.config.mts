import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const port = 4300;
const baseURL = `http://localhost:${port}`;
const dataDir = join(workspaceRoot, 'tmp', 'web-e2e-data');

// Start from an empty data directory on every run.
rmSync(dataDir, { recursive: true, force: true });

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * Generated as a .mts file so Node forces ESM regardless of workspace
 * `type`. Playwright routes `.mts` through its ESM loader (dynamic import,
 * bypassing the pirates CJS-compile path), and Nx's native TS strip loads
 * `.mts` directly. Playwright's configLoader auto-discovers
 * `playwright.config.mts` via its extension list
 * (.ts/.js/.mts/.mjs/.cts/.cjs).
 */
export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  // The production path: the built server serves the built web client.
  webServer: {
    command: 'node dist/apps/server/main.js',
    url: `${baseURL}/api/health/ready`,
    reuseExistingServer: !process.env['CI'],
    cwd: workspaceRoot,
    env: {
      FRONT_BURNER_PORT: String(port),
      FRONT_BURNER_DATA_DIR: dataDir,
      FRONT_BURNER_LOG_FORMAT: 'json'
    }
  },
  // NF-12.2: desktop and mobile browsers.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 14'] } }
  ]
});
