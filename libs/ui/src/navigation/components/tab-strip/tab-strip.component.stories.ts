import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, userEvent, within } from 'storybook/test';
import { IslandComponent } from '../../../layout/components/island/island.component';
import { TabContentDirective } from '../../directives/tab-content/tab-content.directive';
import { TabGroupDirective } from '../../directives/tab-group/tab-group.directive';
import { TabPanelDirective } from '../../directives/tab-panel/tab-panel.directive';
import { TabComponent } from '../tab/tab.component';
import { TabStripComponent } from './tab-strip.component';

const meta: Meta<TabStripComponent> = {
  title: 'Navigation/Tab strip',
  component: TabStripComponent,
  decorators: [
    story => ({
      ...story(),
      moduleMetadata: {
        imports: [ IslandComponent, TabContentDirective, TabGroupDirective, TabComponent, TabPanelDirective ]
      }
    })
  ],
  parameters: { layout: 'fullscreen' }
};

export default meta;

type Story = StoryObj<TabStripComponent>;

/** The tabs of the left pane, in the header of an island (GA-10). */
export const LeftPane: Story = {
  render: () => ({
    styles: [ '.canvas { display: grid; block-size: 20rem; padding: var(--ui-island-gap); }' ],
    template: `
      <div class="canvas">
        <ui-island uiTabGroup label="Left pane">
          <ui-tab-strip uiIslandHeader label="Left pane" selected="files">
            <button uiTab="files">Files</button>
            <button uiTab="changes">Changes (3)</button>
          </ui-tab-strip>
          <div uiTabPanel="files"><ng-template uiTabContent>The file tree.</ng-template></div>
          <div uiTabPanel="changes"><ng-template uiTabContent>Three changed files.</ng-template></div>
        </ui-island>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const files = canvas.getByRole('tab', { name: 'Files' });
    const changes = canvas.getByRole('tab', { name: 'Changes (3)' });

    await userEvent.click(changes);
    await expect(canvas.getByRole('tabpanel', { name: 'Changes (3)' })).toBeVisible();
    await expect(canvas.getByText('The file tree.')).not.toBeVisible();

    await userEvent.keyboard('{ArrowLeft}');
    await expect(files).toHaveAttribute('aria-selected', 'true');
    await expect(files).toHaveFocus();
  }
};

/** Edit and Preview on a narrow screen (ED-34), in 20rem. */
export const EditPreview: Story = {
  render: () => ({
    styles: [ '.narrow { inline-size: 20rem; }' ],
    template: `
      <div class="narrow" uiTabGroup>
        <ui-tab-strip label="Editor view" selected="edit">
          <button uiTab="edit">Edit</button>
          <button uiTab="preview">Preview</button>
        </ui-tab-strip>
        <div uiTabPanel="edit"><ng-template uiTabContent>The Markdown source.</ng-template></div>
        <div uiTabPanel="preview"><ng-template uiTabContent>The rendered preview.</ng-template></div>
      </div>
    `
  })
};
