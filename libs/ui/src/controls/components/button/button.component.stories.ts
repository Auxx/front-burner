import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent } from 'storybook/test';
import { ButtonComponent } from './button.component';

// Codicon `repo-pull` (CC-BY-4.0), inline until the Icon component exists.
const pull =
  'M4.85 6.15C4.755 6.05 4.627 6 4.5 6C4.372 6 4.245 6.05 4.15 6.15C4.05 6.245 4 6.373 4 6.5C4 6.627 4.05 6.755 4.15 6.85L7.15 9.85C7.245 9.95 7.372 10 7.5 10C7.628 10 7.755 9.95 7.85 9.85L10.85 6.85C10.95 6.755 11 6.628 11 6.5C11 6.372 10.95 6.245 10.85 6.15C10.755 6.05 10.627 6 10.5 6C10.373 6 10.245 6.05 10.15 6.15L8 8.29V1.5C8 1.22 7.78 1 7.5 1C7.22 1 7 1.22 7 1.5V8.29L4.85 6.15Z M9.95 13H12.5C12.78 13 13 13.22 13 13.5C13 13.78 12.78 14 12.5 14H9.95C9.72 15.14 8.71 16 7.5 16C6.29 16 5.28 15.14 5.05 14H2.5C2.22 14 2 13.78 2 13.5C2 13.22 2.22 13 2.5 13H5.05C5.28 11.86 6.29 11 7.5 11C8.71 11 9.72 11.86 9.95 13ZM6.09 14C6.29 14.58 6.85 15 7.5 15C8.15 15 8.71 14.58 8.91 14C8.97 13.84 9 13.68 9 13.5C9 13.32 8.97 13.16 8.91 13C8.71 12.42 8.15 12 7.5 12C6.85 12 6.29 12.42 6.09 13C6.03 13.16 6 13.32 6 13.5C6 13.68 6.03 13.84 6.09 14Z';

const meta: Meta<ButtonComponent> = {
  title: 'Controls/Button',
  component: ButtonComponent
};

export default meta;

type Story = StoryObj<ButtonComponent>;

const row = '.row { display: flex; flex-wrap: wrap; gap: var(--ui-space-2); margin-block-end: var(--ui-space-3); }';

/** Each variant, enabled and disabled. */
export const Variants: Story = {
  render: () => ({
    styles: [ row ],
    template: `
      <div class="row">
        <button uiButton variant="primary">Add repository</button>
        <button uiButton>Cancel</button>
        <button uiButton variant="danger">Remove repository</button>
        <button uiButton variant="ghost">Try again</button>
      </div>
      <div class="row">
        <button uiButton variant="primary" disabled>Add repository</button>
        <button uiButton disabled>Cancel</button>
        <button uiButton variant="danger" disabled>Remove repository</button>
        <button uiButton variant="ghost" disabled>Try again</button>
      </div>
    `
  })
};

/** A leading icon. */
export const WithIcon: Story = {
  render: () => ({
    props: { pull },
    styles: [ 'svg { inline-size: var(--ui-icon-size); block-size: var(--ui-icon-size); }' ],
    template: `
      <button uiButton>
        <svg viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path [attr.d]="pull" /></svg>
        Pull
      </button>
    `
  })
};

/** The buttons above each conflict (GC-11). */
export const Small: Story = {
  render: () => ({
    styles: [ row ],
    template: `
      <div class="row">
        <button uiButton size="small">Accept mine</button>
        <button uiButton size="small">Accept theirs</button>
        <button uiButton size="small">Accept both</button>
      </div>
    `
  })
};

/** A link that looks like a button. */
export const Link: Story = {
  render: () => ({
    template: `<a uiButton variant="primary" href="#add">Add repository</a>`
  })
};

/** A long label on the smallest supported screen (NF-12.4). */
export const LongLabel: Story = {
  render: () => ({
    styles: [ '.narrow { inline-size: 20rem; }' ],
    template: `
      <div class="narrow">
        <button uiButton>Open a-repository-name-of-sixty-characters-without-any-breaks-x</button>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const wrapper = canvasElement.querySelector('.narrow') as HTMLElement;
    await expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);
  }
};

/** A button whose operation runs: a spinner replaces its icon (GA-9). */
export const Busy: Story = {
  render: () => ({
    props: {
      pull,
      busy: false,
      start(this: { busy: boolean; }) {
        this.busy = true;
        setTimeout(() => (this.busy = false), 1000);
      }
    },
    styles: [ 'svg { inline-size: var(--ui-icon-size); block-size: var(--ui-icon-size); }' ],
    template: `
      <button uiButton [busy]="busy" (click)="start()">
        <svg viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path [attr.d]="pull" /></svg>
        Pull
      </button>
    `
  }),
  play: async () => {
    const button = screen.getByRole('button', { name: 'Pull' });

    await userEvent.click(button);

    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveFocus();
  }
};
