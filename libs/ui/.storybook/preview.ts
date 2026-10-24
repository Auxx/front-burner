import type { Preview } from '@storybook/angular';

const preview: Preview = {
  parameters: {
    a11y: {
      // Violations fail the story in the a11y panel and in the test-runner
      // (A-10.29, NF-13.8).
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
