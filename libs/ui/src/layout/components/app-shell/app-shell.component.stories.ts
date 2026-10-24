import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { AppShellSideDirective } from '../../directives/app-shell-side/app-shell-side.directive';
import { ActivityBarItemComponent } from '../activity-bar-item/activity-bar-item.component';
import { ActivityBarComponent } from '../activity-bar/activity-bar.component';
import { IslandComponent } from '../island/island.component';
import { SplitPaneComponent } from '../split-pane/split-pane.component';
import { StatusBarComponent } from '../status-bar/status-bar.component';
import { AppShellComponent } from './app-shell.component';

// Codicons `files` and `source-control` (CC-BY-4.0), inline until the Icon
// component exists.
const icons = {
  files:
    'M7.5 22.5H17.595C17.07 23.4 16.11 24 15 24H7.5C4.185 24 1.5 21.315 1.5 18V6C1.5 4.89 2.1 3.93 3 3.405V18C3 20.475 5.025 22.5 7.5 22.5ZM21 8.121V18C21 19.6545 19.6545 21 18 21H7.5C5.8455 21 4.5 19.6545 4.5 18V3C4.5 1.3455 5.8455 0 7.5 0H12.879C13.4715 0 14.0505 0.24 14.4705 0.6585L20.3415 6.5295C20.766 6.954 21 7.5195 21 8.121ZM13.5 6.75C13.5 7.164 13.8375 7.5 14.25 7.5H19.1895L13.5 1.8105V6.75ZM19.5 18V9H14.25C13.0095 9 12 7.9905 12 6.75V1.5H7.5C6.672 1.5 6 2.1735 6 3V18C6 18.8265 6.672 19.5 7.5 19.5H18C18.828 19.5 19.5 18.8265 19.5 18Z',
  changes:
    'M21 8.25C21 6.1815 19.3185 4.5 17.25 4.5C15.1815 4.5 13.5 6.1815 13.5 8.25C13.5 10.023 14.739 11.5035 16.395 11.892C16.116 12.819 15.2655 13.5 14.25 13.5H9.75C8.9025 13.5 8.1285 13.7925 7.5 14.268V7.4235C9.21 7.0755 10.5 5.5605 10.5 3.75C10.5 1.6815 8.8185 0 6.75 0C4.6815 0 3 1.6815 3 3.75C3 5.562 4.29 7.0755 6 7.4235V16.575C4.29 16.923 3 18.438 3 20.2485C3 22.317 4.6815 23.9985 6.75 23.9985C8.8185 23.9985 10.5 22.317 10.5 20.2485C10.5 18.4755 9.261 16.995 7.605 16.6065C7.884 15.6795 8.7345 14.9985 9.75 14.9985H14.25C16.0845 14.9985 17.61 13.6725 17.931 11.9295C19.674 11.607 21 10.0845 21 8.25ZM4.5 3.75C4.5 2.5095 5.5095 1.5 6.75 1.5C7.9905 1.5 9 2.5095 9 3.75C9 4.9905 7.9905 6 6.75 6C5.5095 6 4.5 4.9905 4.5 3.75ZM9 20.25C9 21.4905 7.9905 22.5 6.75 22.5C5.5095 22.5 4.5 21.4905 4.5 20.25C4.5 19.0095 5.5095 18 6.75 18C7.9905 18 9 19.0095 9 20.25ZM17.25 10.5C16.0095 10.5 15 9.4905 15 8.25C15 7.0095 16.0095 6 17.25 6C18.4905 6 19.5 7.0095 19.5 8.25C19.5 9.4905 18.4905 10.5 17.25 10.5Z'
};

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
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path [attr.d]="icons.files" /></svg>
      </button>
      <button uiActivityBarItem="changes" label="Changes">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path [attr.d]="icons.changes" /></svg>
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
    props: { icons, panel: 'files', drawerOpen: false, select },
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
