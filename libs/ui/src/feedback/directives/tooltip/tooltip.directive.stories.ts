import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';

import { IconComponent } from '../../../content/components/icon/icon.component';
import { ButtonComponent } from '../../../controls/components/button/button.component';
import { IconButtonComponent } from '../../../controls/components/icon-button/icon-button.component';
import { TOOLTIP_SHOW_DELAY_MS } from '../../utils/tooltip/tooltip.util';
import { TooltipDirective } from './tooltip.directive';

const meta: Meta<TooltipDirective> = {
  title: 'Feedback/Tooltip',
  component: TooltipDirective,
  decorators: [
    story => ({ ...story(), moduleMetadata: { imports: [ IconComponent, ButtonComponent, IconButtonComponent ] } })
  ]
};

export default meta;

type Story = StoryObj<TooltipDirective>;

const row = '.row { display: flex; gap: var(--ui-space-1); padding-block-start: var(--ui-space-8); }';
const visibleTooltip = () => document.querySelector('ui-tooltip');

/** Icon buttons show their label as a tooltip (GA-7). */
export const IconButtons: Story = {
  render: () => ({
    styles: [ row ],
    template: `
      <div class="row">
        <button uiIconButton label="Fetch">
          <ui-icon name="repo-fetch" />
        </button>
        <button uiIconButton label="Pull">
          <ui-icon name="repo-pull" />
        </button>
        <button uiIconButton label="Push">
          <ui-icon name="repo-push" />
        </button>
      </div>
    `
  }),
  play: async () => {
    await userEvent.tab();

    await expect(screen.getByRole('button', { name: 'Fetch' })).toHaveFocus();
    await expect(visibleTooltip()).toHaveTextContent('Fetch');
  }
};

/** An unavailable button says why on hover, focus or tap (GA-8). */
export const Unavailable: Story = {
  render: () => ({
    styles: [ row ],
    template: `
      <div class="row">
        <button uiButton unavailable uiTooltip="Nothing to push">Push</button>
      </div>
    `
  }),
  play: async () => {
    const push = screen.getByRole('button', { name: 'Push' });

    await userEvent.click(push);

    await expect(visibleTooltip()).toHaveTextContent('Nothing to push');
    await expect(push).toHaveFocus();
  }
};

/** The ignored icon of a file tree row explains itself on tap (FB-20a). */
export const Ignored: Story = {
  render: () => ({
    styles: [
      row,
      '.entry { display: flex; align-items: center; gap: var(--ui-space-1); color: var(--ui-git-ignored); }'
    ],
    template: `
      <div class="row">
        <span class="entry">
          <ui-icon name="markdown" />
          notes.md
          <button
            uiIconButton
            size="small"
            label="Ignored"
            uiTooltip="Ignored by .gitignore. Git won't commit this file."
            uiTooltipShowOnClick
          >
            <ui-icon name="diff-ignored" />
          </button>
        </span>
      </div>
    `
  })
};

/** A long tooltip at the right edge of a phone screen stays on it (NF-12.4). */
export const Edge: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  render: () => ({
    styles: [ '.edge { display: flex; justify-content: flex-end; padding-block-start: var(--ui-space-8); }' ],
    template: `
      <div class="edge">
        <button
          uiButton
          uiTooltip="The remote rejected the push because the branch is protected. Ask the repository's owner to let you push to it, or push to another branch and open a pull request on the provider instead."
        >
          Why?
        </button>
      </div>
    `
  }),
  play: async () => {
    await userEvent.hover(screen.getByRole('button', { name: 'Why?' }));

    await waitFor(() => expect(visibleTooltip()).not.toBeNull(), { timeout: TOOLTIP_SHOW_DELAY_MS * 4 });

    const rect = (visibleTooltip() as HTMLElement).getBoundingClientRect();
    const button = screen.getByRole('button', { name: 'Why?' }).getBoundingClientRect();
    await expect(rect.left).toBeGreaterThanOrEqual(0);
    await expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
    // It does not cover its button.
    await expect(rect.top >= button.bottom || rect.bottom <= button.top).toBe(true);
  }
};
