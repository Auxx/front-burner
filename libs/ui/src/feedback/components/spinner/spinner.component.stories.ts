import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen } from 'storybook/test';

import { IslandComponent } from '../../../layout/components/island/island.component';
import { SpinnerComponent } from './spinner.component';

const meta: Meta<SpinnerComponent> = {
  title: 'Feedback/Spinner',
  component: SpinnerComponent
};

export default meta;

type Story = StoryObj<SpinnerComponent>;

/** A decorative spinner, hidden from assistive technology. */
export const Default: Story = {
  render: () => ({
    template: `<ui-spinner />`
  })
};

/** A spinner that stands alone and says what loads (DS-25). */
export const Labelled: Story = {
  render: () => ({
    template: `<ui-spinner label="Loading repositories" />`
  }),
  play: async () => {
    await expect(screen.getByRole('progressbar', { name: 'Loading repositories' })).toBeVisible();
  }
};

/** Next to text in an island, as a folder that loads (FB-43). */
export const InText: Story = {
  render: () => ({
    moduleMetadata: { imports: [ IslandComponent ] },
    styles: [ '.loading { display: flex; align-items: center; gap: var(--ui-space-2); color: var(--ui-text-muted); }' ],
    template: `
      <ui-island heading="Files">
        <p class="loading"><ui-spinner /> Loading…</p>
      </ui-island>
    `
  })
};
