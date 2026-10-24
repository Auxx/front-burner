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
  // The dev server only serves files under its own root; packages such as the
  // fonts (_fonts.scss) live in the workspace's node_modules.
  viteFinal: async config => {
    const { mergeConfig } = await import('vite');
    return mergeConfig(config, { server: { fs: { allow: [ workspaceRoot ] } } });
  }
};

export default config;
