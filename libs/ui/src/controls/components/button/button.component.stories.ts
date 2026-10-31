import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent } from 'storybook/test';
import { IconComponent } from '../../../content/components/icon/icon.component';
import { ButtonComponent } from './button.component';

const meta: Meta<ButtonComponent> = {
  title: 'Controls/Button',
  component: ButtonComponent,
  decorators: [ story => ({ ...story(), moduleMetadata: { imports: [ IconComponent ] } }) ]
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
    template: `
      <button uiButton>
        <ui-icon name="repo-pull" />
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
      busy: false,
      start(this: { busy: boolean; }) {
        this.busy = true;
        setTimeout(() => (this.busy = false), 1000);
      }
    },
    template: `
      <button uiButton [busy]="busy" (click)="start()">
        <ui-icon name="repo-pull" />
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

/** An icon in front of a label stays `--ui-icon-size` square in every size. */
export const GhostWithIconAndText: Story = {
  render: () => ({
    template: `
      <div class="row">
        <button uiButton variant="ghost"><ui-icon name="files" /> Files</button>
        <button uiButton variant="ghost" size="small"><ui-icon name="files" /> Files</button>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    for (const icon of canvasElement.querySelectorAll('ui-icon')) {
      const box = icon.getBoundingClientRect();
      await expect([ box.width, box.height ]).toEqual([ 16, 16 ]);
    }
  }
};
