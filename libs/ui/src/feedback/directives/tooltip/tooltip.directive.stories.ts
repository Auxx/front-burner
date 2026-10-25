import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';

import { ButtonComponent } from '../../../controls/components/button/button.component';
import { IconButtonComponent } from '../../../controls/components/icon-button/icon-button.component';
import { TOOLTIP_SHOW_DELAY_MS } from '../../utils/tooltip/tooltip.util';
import { TooltipDirective } from './tooltip.directive';

// Codicons `repo-fetch`, `repo-pull`, `repo-push`, `diff-ignored` and
// `markdown` (CC-BY-4.0), inline until the Icon component exists.
const icons = {
  fetch:
    'M7.5 3C7.776 3 8 2.776 8 2.5V1.5C8 1.224 7.776 1 7.5 1C7.224 1 7 1.224 7 1.5V2.5C7 2.776 7.224 3 7.5 3Z M7.5 10C7.372 10 7.245 9.95 7.15 9.85L4.15 6.85C4.05 6.755 4 6.628 4 6.5C4 6.372 4.05 6.245 4.15 6.15C4.245 6.05 4.373 6 4.5 6C4.627 6 4.755 6.05 4.85 6.15L7 8.29V7.5C7 7.22 7.22 7 7.5 7C7.78 7 8 7.22 8 7.5V8.29L10.15 6.15C10.245 6.05 10.372 6 10.5 6C10.628 6 10.755 6.05 10.85 6.15C10.95 6.245 11 6.373 11 6.5C11 6.627 10.95 6.755 10.85 6.85L7.85 9.85C7.755 9.95 7.628 10 7.5 10Z M9.95 13H12.5C12.78 13 13 13.22 13 13.5C13 13.78 12.78 14 12.5 14H9.95C9.72 15.14 8.71 16 7.5 16C6.29 16 5.28 15.14 5.05 14H2.5C2.22 14 2 13.78 2 13.5C2 13.22 2.22 13 2.5 13H5.05C5.28 11.86 6.29 11 7.5 11C8.71 11 9.72 11.86 9.95 13ZM7.5 15C8.15 15 8.71 14.58 8.91 14C8.97 13.84 9 13.68 9 13.5C9 13.32 8.97 13.16 8.91 13C8.71 12.42 8.15 12 7.5 12C6.85 12 6.29 12.42 6.09 13C6.03 13.16 6 13.32 6 13.5C6 13.68 6.03 13.84 6.09 14C6.29 14.58 6.85 15 7.5 15Z M8 5.5C8 5.776 7.776 6 7.5 6C7.224 6 7 5.776 7 5.5V4.5C7 4.224 7.224 4 7.5 4C7.776 4 8 4.224 8 4.5V5.5Z',
  pull:
    'M4.85 6.15C4.755 6.05 4.627 6 4.5 6C4.372 6 4.245 6.05 4.15 6.15C4.05 6.245 4 6.373 4 6.5C4 6.627 4.05 6.755 4.15 6.85L7.15 9.85C7.245 9.95 7.372 10 7.5 10C7.628 10 7.755 9.95 7.85 9.85L10.85 6.85C10.95 6.755 11 6.628 11 6.5C11 6.372 10.95 6.245 10.85 6.15C10.755 6.05 10.627 6 10.5 6C10.373 6 10.245 6.05 10.15 6.15L8 8.29V1.5C8 1.22 7.78 1 7.5 1C7.22 1 7 1.22 7 1.5V8.29L4.85 6.15Z M9.95 13H12.5C12.78 13 13 13.22 13 13.5C13 13.78 12.78 14 12.5 14H9.95C9.72 15.14 8.71 16 7.5 16C6.29 16 5.28 15.14 5.05 14H2.5C2.22 14 2 13.78 2 13.5C2 13.22 2.22 13 2.5 13H5.05C5.28 11.86 6.29 11 7.5 11C8.71 11 9.72 11.86 9.95 13ZM6.09 14C6.29 14.58 6.85 15 7.5 15C8.15 15 8.71 14.58 8.91 14C8.97 13.84 9 13.68 9 13.5C9 13.32 8.97 13.16 8.91 13C8.71 12.42 8.15 12 7.5 12C6.85 12 6.29 12.42 6.09 13C6.03 13.16 6 13.32 6 13.5C6 13.68 6.03 13.84 6.09 14Z',
  push:
    'M4.85 4.85C4.755 4.95 4.627 5 4.5 5C4.372 5 4.245 4.95 4.15 4.85C4.05 4.755 4 4.627 4 4.5C4 4.373 4.05 4.245 4.15 4.15L7.15 1.15C7.245 1.05 7.372 1 7.5 1C7.628 1 7.755 1.05 7.85 1.15L10.85 4.15C10.95 4.245 11 4.372 11 4.5C11 4.628 10.95 4.755 10.85 4.85C10.755 4.95 10.627 5 10.5 5C10.373 5 10.245 4.95 10.15 4.85L8 2.71V9.5C8 9.78 7.78 10 7.5 10C7.22 10 7 9.78 7 9.5V2.71L4.85 4.85Z M9.95 13H12.5C12.78 13 13 13.22 13 13.5C13 13.78 12.78 14 12.5 14H9.95C9.72 15.14 8.71 16 7.5 16C6.29 16 5.28 15.14 5.05 14H2.5C2.22 14 2 13.78 2 13.5C2 13.22 2.22 13 2.5 13H5.05C5.28 11.86 6.29 11 7.5 11C8.71 11 9.72 11.86 9.95 13ZM6.09 14C6.29 14.58 6.85 15 7.5 15C8.15 15 8.71 14.58 8.91 14C8.97 13.84 9 13.68 9 13.5C9 13.32 8.97 13.16 8.91 13C8.71 12.42 8.15 12 7.5 12C6.85 12 6.29 12.42 6.09 13C6.03 13.16 6 13.32 6 13.5C6 13.68 6.03 13.84 6.09 14Z',
  ignored:
    'M11.5 1H3.5C2.122 1 1 2.122 1 3.5V11.5C1 12.878 2.122 14 3.5 14H11.5C12.878 14 14 12.878 14 11.5V3.5C14 2.122 12.878 1 11.5 1ZM13 11.5C13 12.327 12.327 13 11.5 13H3.5C2.673 13 2 12.327 2 11.5V3.5C2 2.673 2.673 2 3.5 2H11.5C12.327 2 13 2.673 13 3.5V11.5ZM10.854 4.146C11.049 4.341 11.049 4.658 10.854 4.853L4.854 10.853C4.756 10.951 4.628 10.999 4.5 10.999C4.372 10.999 4.244 10.95 4.146 10.853C3.951 10.658 3.951 10.341 4.146 10.146L10.146 4.146C10.341 3.951 10.659 3.951 10.854 4.146Z',
  markdown:
    'M9 3.5V11.5C9 11.776 8.776 12 8.5 12C8.224 12 8 11.776 8 11.5V4.831L5.376 7.83C5.187 8.048 4.814 8.048 4.624 7.83L2 4.831V11.5C2 11.776 1.776 12 1.5 12C1.224 12 1 11.776 1 11.5V3.5C1 3.292 1.129 3.105 1.324 3.032C1.521 2.96 1.74 3.014 1.876 3.171L5 6.741L8.124 3.171C8.261 3.014 8.478 2.959 8.676 3.032C8.871 3.105 9 3.292 9 3.5ZM14.854 9.146C14.659 8.951 14.342 8.951 14.147 9.146L13.001 10.292V3.5C13.001 3.224 12.777 3 12.501 3C12.225 3 12.001 3.224 12.001 3.5V10.293L10.855 9.147C10.66 8.952 10.343 8.952 10.148 9.147C9.953 9.342 9.953 9.659 10.148 9.854L12.148 11.854C12.246 11.952 12.757 11.952 12.855 11.854L14.855 9.854C15.05 9.659 15.05 9.342 14.855 9.147L14.854 9.146Z'
};

const meta: Meta<TooltipDirective> = {
  title: 'Feedback/Tooltip',
  component: TooltipDirective,
  decorators: [
    story => ({ ...story(), moduleMetadata: { imports: [ ButtonComponent, IconButtonComponent ] } })
  ]
};

export default meta;

type Story = StoryObj<TooltipDirective>;

const iconSize = 'svg { inline-size: var(--ui-icon-size); block-size: var(--ui-icon-size); }';
const row = '.row { display: flex; gap: var(--ui-space-1); padding-block-start: var(--ui-space-8); }';
const visibleTooltip = () => document.querySelector('ui-tooltip');

/** Icon buttons show their label as a tooltip (GA-7). */
export const IconButtons: Story = {
  render: () => ({
    props: { icons },
    styles: [ iconSize, row ],
    template: `
      <div class="row">
        <button uiIconButton label="Fetch">
          <svg viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path [attr.d]="icons.fetch" /></svg>
        </button>
        <button uiIconButton label="Pull">
          <svg viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path [attr.d]="icons.pull" /></svg>
        </button>
        <button uiIconButton label="Push">
          <svg viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path [attr.d]="icons.push" /></svg>
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
    props: { icons },
    styles: [
      iconSize,
      row,
      '.entry { display: flex; align-items: center; gap: var(--ui-space-1); color: var(--ui-git-ignored); }'
    ],
    template: `
      <div class="row">
        <span class="entry">
          <svg viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path [attr.d]="icons.markdown" /></svg>
          notes.md
          <button
            uiIconButton
            size="small"
            label="Ignored"
            uiTooltip="Ignored by .gitignore. Git won't commit this file."
            uiTooltipShowOnClick
          >
            <svg viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path [attr.d]="icons.ignored" /></svg>
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
