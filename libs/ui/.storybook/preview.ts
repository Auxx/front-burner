import type { Decorator, Preview } from '@storybook/angular';

/**
 * Sets `data-theme` and `data-density` on the root, so that every story can be
 * checked in both colour schemes and both densities (A-10.37). "System" removes
 * the attribute and follows the platform.
 */
const withThemeAndDensity: Decorator = (story, context) => {
  const root = document.documentElement;
  for (const name of [ 'theme', 'density' ]) {
    const value = context.globals[name];
    if (value && value !== 'system') {
      root.setAttribute(`data-${name}`, value);
    } else {
      root.removeAttribute(`data-${name}`);
    }
  }
  return story();
};

const preview: Preview = {
  decorators: [ withThemeAndDensity ],
  globalTypes: {
    theme: {
      description: 'Colour scheme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'system', title: 'System' },
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' }
        ],
        dynamicTitle: true
      }
    },
    density: {
      description: 'Density',
      toolbar: {
        title: 'Density',
        icon: 'component',
        items: [
          { value: 'system', title: 'System' },
          { value: 'compact', title: 'Compact' },
          { value: 'touch', title: 'Touch' }
        ],
        dynamicTitle: true
      }
    }
  },
  initialGlobals: {
    theme: 'system',
    density: 'system'
  },
  parameters: {
    a11y: {
      // Violations fail the story in the a11y panel and in the test-runner
      // (A-10.38, NF-13.8).
      test: 'error',
      options: {
        // WCAG 2.2 level AA (NF-13.1).
        runOnly: {
          type: 'tag',
          values: [ 'wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa' ]
        }
      }
    }
  }
};

export default preview;
