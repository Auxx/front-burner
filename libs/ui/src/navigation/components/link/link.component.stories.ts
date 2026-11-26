import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect } from 'storybook/test';
import { LinkComponent } from './link.component';

const meta: Meta<LinkComponent> = {
  title: 'Navigation/Link',
  component: LinkComponent
};

export default meta;

type Story = StoryObj<LinkComponent>;

// Each on its own, spaced as the dashboard's tiles space them.
const list = `
  <div class="list">
    <a uiLink href="/repositories/1">a</a>
    <a uiLink href="/repositories">All repositories</a>
  </div>
`;
const styles = [ '.list { display: grid; justify-items: start; gap: var(--ui-space-3); }' ];

/** Links on their own, such as a repository's name and **All repositories**. */
export const Standalone: Story = {
  render: () => ({ styles, template: list })
};

/**
 * At touch density each link is a 44 px target, even with a one-letter name
 * (NF-13.5).
 */
export const TouchTargets: Story = {
  ...Standalone,
  globals: { density: 'touch' },
  play: async ({ canvasElement }) => {
    for (const link of canvasElement.querySelectorAll('a')) {
      const box = link.getBoundingClientRect();
      await expect(box.width).toBeGreaterThanOrEqual(44);
      await expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
};
