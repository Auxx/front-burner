import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { storybookAngularVitest } from '@storybook/angular-vite/vitest';
import { playwright } from '@vitest/browser-playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const projectRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Runs every Storybook story as a test in a real browser: its play function and
 * the axe checks of the a11y addon (A-10.38). Used by the `test-storybook`
 * target and by the test panel of the running Storybook.
 *
 * Unit tests do not use this file: the Angular unit-test builder only loads a
 * Vitest config when `runnerConfig` is set.
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        plugins: [
          storybookTest({ configDir: join(projectRoot, '.storybook') }),
          // Carries the Angular options into standalone runs and lets the
          // browser load @angular/compiler from the workspace's node_modules.
          storybookAngularVitest()
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [ { browser: 'chromium' } ]
          }
        }
      }
    ]
  }
});
