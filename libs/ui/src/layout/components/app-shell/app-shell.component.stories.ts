import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { IconComponent } from '../../../content/components/icon/icon.component';
import { AppShellSideDirective } from '../../directives/app-shell-side/app-shell-side.directive';
import { ActivityBarItemComponent } from '../activity-bar-item/activity-bar-item.component';
import { ActivityBarComponent } from '../activity-bar/activity-bar.component';
import { IslandComponent } from '../island/island.component';
import { SplitPaneComponent } from '../split-pane/split-pane.component';
import { StatusBarComponent } from '../status-bar/status-bar.component';
import { AppShellComponent } from './app-shell.component';

interface ScreenState {
  panel: string | null;
  drawerOpen: boolean;
}

/** The activity bar collapses the side panel on wide screens, and opens the drawer on narrow ones. */
function select(this: ScreenState, value: string | null, narrow: boolean): void {
  if (narrow) {
    this.drawerOpen = value !== null;
    this.panel = value ?? this.panel;
  } else {
    this.panel = value;
  }
}

const repositoryScreen = `
  <ui-app-shell
    #shell
    skipLinkLabel="Skip to content"
    [sideOpen]="panel !== null"
    (sideOpenChange)="panel = $event ? 'files' : null"
    [(drawerOpen)]="drawerOpen"
  >
    <strong uiAppShellHeader>handbook</strong>
    <ui-activity-bar label="Side panel" [orientation]="shell.narrow() ? 'horizontal' : 'vertical'"
      [selected]="shell.narrow() && !drawerOpen ? null : panel"
      (selectedChange)="select($event, shell.narrow())"
    >
      <button uiActivityBarItem="files" label="Files">
        <ui-icon name="files" />
      </button>
      <button uiActivityBarItem="changes" label="Changes">
        <ui-icon name="source-control" />
      </button>
    </ui-activity-bar>
    <ui-island uiAppShellSide resizeLabel="Resize side panel" [heading]="panel === 'changes' ? 'Changes' : 'Files'">
      <p>README.md</p>
    </ui-island>
    <ui-split-pane separatorLabel="Resize editor">
      <ui-island uiSplitPaneStart label="Editor"><p># Handbook</p></ui-island>
      <ui-island uiSplitPaneEnd label="Preview"><h1>Handbook</h1></ui-island>
    </ui-split-pane>
    <ui-status-bar label="Status">
      main · 2 to push
      <span uiStatusBarEnd>Saved</span>
    </ui-status-bar>
  </ui-app-shell>
`;

const meta: Meta<AppShellComponent> = {
  title: 'Layout/App shell',
  component: AppShellComponent,
  parameters: {
    layout: 'fullscreen'
  },
  decorators: [
    story => ({
      ...story(),
      moduleMetadata: {
        imports: [
          IconComponent,
          ActivityBarComponent,
          ActivityBarItemComponent,
          AppShellSideDirective,
          IslandComponent,
          SplitPaneComponent,
          StatusBarComponent
        ]
      }
    })
  ],
  render: () => ({
    props: { panel: 'files', drawerOpen: false, select },
    template: repositoryScreen
  })
};

export default meta;

type Story = StoryObj<AppShellComponent>;

/** The file tree, then the editor and the preview (FB-7). */
export const RepositoryScreen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // No gap between the activity bar and the side panel; the activity bar
    // has its own padding.
    const activityBar = canvas.getByRole('toolbar', { name: 'Side panel' });
    const files = canvas.getByRole('region', { name: 'Files' });
    await expect(files.getBoundingClientRect().left).toBe(activityBar.getBoundingClientRect().right);

    // Islands fill their panes.
    const editor = canvas.getByRole('region', { name: 'Editor' });
    const pane = editor.parentElement as HTMLElement;
    await expect(editor.getBoundingClientRect().height).toBe(pane.getBoundingClientRect().height);

    await userEvent.tab();
    const skip = canvas.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(canvas.getByRole('main')).toHaveFocus();

    // Clicking the selected item closes the side panel.
    await userEvent.click(canvas.getByRole('button', { name: 'Files' }));
    await waitFor(() => expect(canvas.queryByRole('region', { name: 'Files' })).toBeNull());
  }
};

export const Dashboard: Story = {
  render: () => ({
    template: `
      <ui-app-shell skipLinkLabel="Skip to content">
        <strong uiAppShellHeader>Front Burner</strong>
        <ui-island heading="Recent repositories"><p>handbook</p></ui-island>
      </ui-app-shell>
    `
  }),
  play: async ({ canvasElement }) => {
    // Without an activity bar, the island keeps its gap from the edge.
    const island = within(canvasElement).getByRole('region', { name: 'Recent repositories' });
    await expect(island.getBoundingClientRect().left).toBeGreaterThan(0);
  }
};

/** On a phone, the activity bar is at the bottom and the side panel is a drawer (A-10.6). */
export const Narrow: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('toolbar', { name: 'Side panel' })).toHaveAttribute('aria-orientation', 'horizontal');

    // The drawer starts closed, over nothing.
    await expect(canvas.getByRole('main')).toBeVisible();
    await expect(canvas.queryByRole('region', { name: 'Files' })).toBeNull();

    const files = canvas.getByRole('button', { name: 'Files' });
    await userEvent.click(files);
    await waitFor(() => expect(canvas.getByRole('region', { name: 'Files' })).toHaveFocus());
    await expect(canvas.queryByRole('main')).toBeNull();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.getByRole('main')).toBeVisible());
    await expect(files).toHaveFocus();
  }
};
