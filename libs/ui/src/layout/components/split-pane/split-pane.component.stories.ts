import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, userEvent, within } from 'storybook/test';
import { IslandComponent } from '../island/island.component';
import { SplitPaneComponent } from './split-pane.component';

const canvas = '.canvas { display: grid; block-size: 24rem; padding: var(--ui-island-gap); }';

const meta: Meta<SplitPaneComponent> = {
  title: 'Layout/Split pane',
  component: SplitPaneComponent,
  parameters: {
    layout: 'fullscreen'
  },
  decorators: [ story => ({ ...story(), moduleMetadata: { imports: [ IslandComponent ] } }) ],
  args: { size: 30, orientation: 'horizontal', show: 'both' },
  render: props => ({
    props,
    styles: [ canvas ],
    template: `
      <div class="canvas">
        <ui-split-pane [(size)]="size" [orientation]="orientation" [show]="show" separatorLabel="Resize first pane">
          <ui-island uiSplitPaneStart heading="First"><p>First pane</p></ui-island>
          <ui-island uiSplitPaneEnd heading="Second"><p>Second pane</p></ui-island>
        </ui-split-pane>
      </div>
    `
  })
};

export default meta;

type Story = StoryObj<SplitPaneComponent>;

export const Horizontal: Story = {
  play: async ({ canvasElement }) => {
    const separator = within(canvasElement).getByRole('separator');
    separator.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(separator).toHaveAttribute('aria-valuenow', '35');
  }
};

export const Vertical: Story = {
  args: { orientation: 'vertical', size: 60 }
};

export const OnePane: Story = {
  args: { show: 'end' }
};

/** The repository screen: the file tree, then the editor and the preview. */
export const Nested: Story = {
  render: props => ({
    props,
    styles: [ canvas ],
    template: `
      <div class="canvas">
        <ui-split-pane [(size)]="size" separatorLabel="Resize file tree">
          <ui-island uiSplitPaneStart heading="Files"><p>Tree</p></ui-island>
          <ui-split-pane uiSplitPaneEnd separatorLabel="Resize editor">
            <ui-island uiSplitPaneStart heading="Editor"><p>Editor</p></ui-island>
            <ui-island uiSplitPaneEnd heading="Preview"><p>Preview</p></ui-island>
          </ui-split-pane>
        </ui-split-pane>
      </div>
    `
  })
};
