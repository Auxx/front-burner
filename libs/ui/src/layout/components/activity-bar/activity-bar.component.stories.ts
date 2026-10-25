import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, userEvent, within } from 'storybook/test';
import { IconComponent } from '../../../content/components/icon/icon.component';
import { ActivityBarItemComponent } from '../activity-bar-item/activity-bar-item.component';
import { ActivityBarComponent } from './activity-bar.component';

/** The story's own arguments: the bar's inputs are signals, which Storybook sets by name. */
interface ActivityBarArgs {
  selected: string;
  orientation: 'horizontal' | 'vertical';
}

const meta: Meta<ActivityBarArgs> = {
  title: 'Layout/Activity bar',
  component: ActivityBarComponent,
  decorators: [ story => ({ ...story(), moduleMetadata: { imports: [ IconComponent, ActivityBarItemComponent ] } }) ],
  args: { selected: 'files', orientation: 'vertical' },
  render: props => ({
    props: { ...props },
    template: `
      <ui-activity-bar label="Side panel" [orientation]="orientation" [(selected)]="selected">
        <button uiActivityBarItem="files" label="Files">
          <ui-icon name="files" />
        </button>
        <button uiActivityBarItem="changes" label="Changes">
          <ui-icon name="source-control" />
        </button>
      </ui-activity-bar>
    `
  })
};

export default meta;

type Story = StoryObj<ActivityBarArgs>;

export const Vertical: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const files = canvas.getByRole('button', { name: 'Files' });
    const changes = canvas.getByRole('button', { name: 'Changes' });

    await userEvent.click(changes);
    await expect(changes).toHaveAttribute('aria-pressed', 'true');
    await expect(files).toHaveAttribute('aria-pressed', 'false');

    await userEvent.keyboard('{ArrowUp}');
    await expect(files).toHaveFocus();
  }
};

/** At the bottom of a narrow screen (A-10.6). */
export const Horizontal: Story = {
  args: { orientation: 'horizontal' }
};
