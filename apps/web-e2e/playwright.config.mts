import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * Generated as a .mts file so Node forces ESM regardless of workspace
 * `type`. Playwright routes `.mts` through its ESM loader (dynamic import,
 * bypassing the pirates CJS-compile path), and Nx's native TS strip loads
 * `.mts` directly. Playwright's configLoader auto-discovers
 * `playwright.config.mts` via its extension list
 * (.ts/.js/.mts/.mjs/.cts/.cjs).
 *
 * There is no web server here: every test starts its own instance of the
 * built server, which serves the built web client (the production path), and
 * gets it as its `baseURL` (see `src/support/fixtures.ts`).
 */
// NF-12.2: desktop and mobile browsers.
const projects = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  { name: 'mobile-webkit', use: { ...devices['iPhone 14'] } }
];

/**
 * `E2E_BROWSERS` (comma-separated browser engines, e.g. `chromium`) limits the
 * run to the projects on those engines. CI sets it to `chromium` on every
 * pull request; the nightly workflow sets `chromium,firefox,webkit` to run
 * every project. Unset, as in local runs, it skips WebKit, which does not run
 * on every developer's operating system; the nightly run covers it (NF-12.2).
 */
const browsers = (process.env['E2E_BROWSERS'] || 'chromium,firefox')
  .split(',')
  .map(browser => browser.trim());

export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    trace: 'on-first-retry'
  },
  projects: projects.filter(project => browsers.includes(project.use.defaultBrowserType))
});
