import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen } from 'storybook/test';

import { ICON_NAMES } from '../../models/icon-name.model';
import { IconComponent } from './icon.component';

const meta: Meta<IconComponent> = {
  title: 'Content/Icon',
  component: IconComponent
};

export default meta;

type Story = StoryObj<IconComponent>;

/** A decorative icon, hidden from assistive technology. */
export const Default: Story = {
  render: () => ({
    template: `<ui-icon name="close" />`
  })
};

/** An icon that carries meaning on its own, such as an ignored file's mark (FB). */
export const Labelled: Story = {
  render: () => ({
    template: `<ui-icon name="info" label="Ignored by git" />`
  }),
  play: async () => {
    await expect(screen.getByRole('img', { name: 'Ignored by git' })).toBeVisible();
  }
};

/** The compact (16 px) and touch (20 px) sizes, set through `--ui-icon-size` on a parent. */
export const Sizes: Story = {
  render: () => ({
    styles: [
      '.sizes { display: flex; align-items: center; gap: var(--ui-space-4); }',
      '.compact { --ui-icon-size: 1rem; }',
      '.touch { --ui-icon-size: 1.25rem; }'
    ],
    template: `
      <p class="sizes">
        <span class="compact"><ui-icon name="repo" /></span>
        <span class="touch"><ui-icon name="repo" /></span>
      </p>
    `
  })
};

/** Every icon of the sprite, with its name. Add one to `ICON_NAMES` and rebuild the sprite. */
export const Gallery: Story = {
  render: () => ({
    props: { names: ICON_NAMES },
    styles: [
      '.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr)); gap: var(--ui-space-3); margin: 0; padding: 0; list-style: none; }',
      '.gallery li { display: flex; flex-direction: column; align-items: center; gap: var(--ui-space-1); color: var(--ui-text-muted); }',
      '.gallery ui-icon { color: var(--ui-icon-default); }'
    ],
    template: `
      <ul class="gallery">
        @for (name of names; track name) {
          <li><ui-icon [name]="name" />{{ name }}</li>
        }
      </ul>
    `
  }),
  // The sprite is served from Storybook's static files, as the web client serves it.
  play: async () => {
    const response = await fetch('assets/icons.svg');
    await expect(response.ok).toBe(true);
    const sprite = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
    const ids = [ ...sprite.querySelectorAll('symbol') ].map(symbol => symbol.id);
    await expect(ids).toEqual([ ...ICON_NAMES ]);
  }
};
