import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent } from 'storybook/test';
import { IconComponent } from '../../../content/components/icon/icon.component';
import { IconButtonComponent } from './icon-button.component';

const meta: Meta<IconButtonComponent> = {
  title: 'Controls/Icon button',
  component: IconButtonComponent,
  decorators: [ story => ({ ...story(), moduleMetadata: { imports: [ IconComponent ] } }) ]
};

export default meta;

type Story = StoryObj<IconButtonComponent>;

/** The git actions of the repository header (GA-7). */
export const GitActions: Story = {
  render: () => ({
    styles: [ '.row { display: flex; gap: var(--ui-space-1); }' ],
    template: `
      <div class="row">
        <button uiIconButton label="Fetch">
          <ui-icon name="repo-fetch" />
        </button>
        <button uiIconButton label="Pull">
          <ui-icon name="repo-pull" />
        </button>
        <button uiIconButton label="Push" variant="secondary" disabled>
          <ui-icon name="repo-push" />
        </button>
      </div>
    `
  })
};

/** A toggle button, such as Show remote images. */
export const Toggle: Story = {
  render: () => ({
    props: { pressed: false },
    template: `
      <button uiIconButton label="Show remote images" [pressed]="pressed" (click)="pressed = !pressed">
        <ui-icon name="eye" />
      </button>
    `
  }),
  play: async () => {
    const button = screen.getByRole('button', { name: 'Show remote images' });

    await userEvent.click(button);

    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
};

/** The git actions while a pull runs (GA-9). */
export const Busy: Story = {
  render: () => ({
    styles: [ '.row { display: flex; gap: var(--ui-space-1); }' ],
    template: `
      <div class="row">
        <button uiIconButton label="Fetch" disabled>
          <ui-icon name="repo-fetch" />
        </button>
        <button uiIconButton label="Pull" busy>
          <ui-icon name="repo-pull" />
        </button>
        <button uiIconButton label="Push" disabled>
          <ui-icon name="repo-push" />
        </button>
      </div>
    `
  })
};

/** The icon keeps `--ui-icon-size` square in both sizes. */
export const IconSize: Story = {
  render: () => ({
    styles: [ '.row { display: flex; gap: var(--ui-space-1); }' ],
    template: `
      <div class="row">
        <button uiIconButton label="Files"><ui-icon name="files" /></button>
        <button uiIconButton label="Files" size="small"><ui-icon name="files" /></button>
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
