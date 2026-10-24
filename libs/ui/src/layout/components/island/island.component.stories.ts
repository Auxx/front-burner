import { Meta, StoryObj } from '@storybook/angular-vite';
import { IslandComponent } from './island.component';

const meta: Meta<IslandComponent> = {
  title: 'Layout/Island',
  component: IslandComponent,
  parameters: {
    layout: 'fullscreen'
  },
  render: props => ({
    props,
    styles: [ '.canvas { display: grid; block-size: 20rem; padding: var(--ui-island-gap); }' ],
    template: `
      <div class="canvas">
        <ui-island [heading]="heading" [label]="label">
          <button uiIslandHeader type="button">Refresh</button>
          @for (line of lines; track $index) {
            <p>Line {{ $index + 1 }} of the body, which scrolls when it is taller than the island.</p>
          }
        </ui-island>
      </div>
    `
  })
};

export default meta;

type Story = StoryObj<IslandComponent & { lines: number[]; }>;

const lines = Array.from({ length: 40 }, (_, index) => index);

export const WithHeading: Story = {
  args: { heading: 'Files', lines }
};

export const LabelOnly: Story = {
  args: { label: 'Preview', lines }
};

/** In a 320 px wide container, the smallest supported screen (NF-12.4). */
export const Narrow: Story = {
  args: { heading: 'A long island heading that is shortened with an ellipsis', lines },
  render: props => ({
    props,
    styles: [ '.canvas { display: grid; inline-size: 20rem; block-size: 20rem; padding: var(--ui-island-gap); }' ],
    template: `
      <div class="canvas">
        <ui-island [heading]="heading">
          @for (line of lines; track $index) {
            <p>Line {{ $index + 1 }}</p>
          }
        </ui-island>
      </div>
    `
  })
};
