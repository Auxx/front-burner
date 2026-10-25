import type { StorybookConfig } from '@storybook/angular-vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(configDir, '../../..');

const config: StorybookConfig = {
  stories: [ '../**/*.@(mdx|stories.@(js|jsx|ts|tsx))' ],
  addons: [ '@storybook/addon-a11y', '@storybook/addon-vitest' ],
  core: {
    disableTelemetry: true
  },
  framework: {
    name: '@storybook/angular-vite',
    options: {
      // Absolute, because Storybook, its build and Vitest each run Vite from a
      // different root.
      tsconfig: join(configDir, 'tsconfig.json')
    }
  },
  viteFinal: async config => {
    const { mergeConfig } = await import('vite');
    return mergeConfig(config, {
      // The dev server only serves files under its own root; packages such as
      // the fonts (_fonts.scss) live in the workspace's node_modules.
      server: { fs: { allow: [ workspaceRoot ] } },
      // Entry points that Vite would otherwise find only while a story loads.
      // A late find bundles them against a second copy of @angular/core, and
      // their `inject()` calls fail (NG0203) on a cold cache, as in CI.
      optimizeDeps: {
        include: [
          '@angular/aria/combobox',
          '@angular/aria/listbox',
          '@angular/aria/menu',
          '@angular/aria/toolbar',
          '@angular/cdk/a11y',
          '@angular/cdk/bidi',
          '@angular/cdk/layout',
          '@angular/cdk/overlay',
          '@angular/cdk/portal',
          '@angular/cdk/scrolling',
          '@angular/core/rxjs-interop'
        ]
      }
    });
  }
};

export default config;
