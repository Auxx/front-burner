import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, userEvent, within } from 'storybook/test';
import { IslandComponent } from '../island/island.component';
import { SplitPaneComponent } from './split-pane.component';

// `.positioned` stands for content such as CodeMirror's `position: relative` editor.
const canvas = `
  .canvas { display: grid; block-size: 24rem; padding: var(--ui-island-gap); }
  .positioned { position: relative; block-size: 100%; }
`;

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
          <ui-island uiSplitPaneEnd heading="Second"><p class="positioned">Second pane</p></ui-island>
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

    // The target is at least 24 px wide (NF-13.5) and grows into the end pane,
    // above its content, leaving the start island's edge and scrollbar alone.
    const { left, top, height } = separator.getBoundingClientRect();
    const y = top + height / 2;
    const at = (x: number) => canvasElement.ownerDocument.elementFromPoint(x, y);
    await expect(at(left - 2)).not.toBe(separator);
    await expect(at(left + 1)).toBe(separator);
    await expect(at(left + 23)).toBe(separator);
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
