import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, within } from 'storybook/test';

import { ButtonComponent } from '../../../controls/components/button/button.component';
import { IslandComponent } from '../../../layout/components/island/island.component';
import { EmptyStateActionsComponent } from '../empty-state-actions/empty-state-actions.component';
import { EmptyStateComponent } from './empty-state.component';

const meta: Meta<EmptyStateComponent> = {
  title: 'Content/EmptyState',
  component: EmptyStateComponent,
  decorators: [
    story => ({
      ...story(),
      moduleMetadata: { imports: [ ButtonComponent, EmptyStateActionsComponent, IslandComponent ] }
    })
  ]
};

export default meta;

type Story = StoryObj<EmptyStateComponent>;

const styles = [
  '.canvas { display: grid; block-size: 28rem; max-inline-size: 40rem; }',
  '.narrow { inline-size: 320px; max-inline-size: none; }',
  '.guide { margin: 0; text-align: start; }',
  'ol { margin: var(--ui-space-3) 0 0; padding-inline-start: var(--ui-space-5); text-align: start; }',
  'li + li { margin-block-start: var(--ui-space-2); }'
];

/** The editor area when the route names no file and there is no README (FB-12). */
export const NoFileOpen: Story = {
  render: () => ({
    styles,
    template: `
      <div class="canvas">
        <ui-island label="Editor" [scrollable]="false">
          <ui-empty-state>
            Choose a file from the tree, or create one
            <div uiEmptyStateActions><button uiButton>New file</button></div>
          </ui-empty-state>
        </ui-island>
      </div>
    `
  })
};

/** The Changes tab when the working copy has no changes (GA-13). */
export const NoChanges: Story = {
  render: () => ({
    styles,
    template: `
      <div class="canvas">
        <ui-island heading="Changes" [scrollable]="false">
          <ui-empty-state icon="check">No changes since the last commit.</ui-empty-state>
        </ui-island>
      </div>
    `
  })
};

const firstRepository = (canvasClass: string) => `
  <div class="${canvasClass}">
    <ui-island label="Repositories">
      <ui-empty-state icon="repo" heading="Add your first repository" [headingLevel]="3">
        <p class="guide">
          Front Burner edits Markdown files in git repositories that already exist on a remote.
          It never creates repositories.
        </p>
        <ol>
          <li>
            <strong>Copy the remote URL</strong> from GitHub, Bitbucket or another git server, either HTTPS
            (for example <code>https://github.com/organisation/a_repository_whose_name_has_no_hyphens_or_spaces_anywhere.git</code>)
            or SSH (for example <code>git&#64;github.com:org/repo.git</code>).
          </li>
          <li>
            <strong>Have your credentials ready</strong>: a username and access token for HTTPS, or an SSH key
            for SSH. Only you can see them.
          </li>
          <li>
            <strong>Choose a clone mode</strong>: <em>Full clone</em> (all branches and history) or
            <em>Single branch</em> (one branch, faster, but with a limited git workflow).
          </li>
        </ol>
        <div uiEmptyStateActions><button uiButton variant="primary">Add repository</button></div>
      </ui-empty-state>
    </ui-island>
  </div>
`;

/** The dashboard's full guide for a user with no repositories (DS-11). */
export const FirstRepository: Story = {
  render: () => ({
    styles,
    template: firstRepository('canvas')
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 3, name: 'Add your first repository' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Add repository' })).toBeVisible();
  }
};

/** The full guide at 320 CSS px: the long remote URL wraps, and nothing scrolls sideways (NF-12.4). */
export const Narrow: Story = {
  render: () => ({
    styles,
    template: firstRepository('canvas narrow')
  }),
  play: async ({ canvasElement }) => {
    const island = canvasElement.querySelector('ui-island') as HTMLElement;
    const state = canvasElement.querySelector('ui-empty-state') as HTMLElement;
    await expect(state.scrollWidth).toBeLessThanOrEqual(state.clientWidth);
    await expect(island.scrollWidth).toBeLessThanOrEqual(island.clientWidth);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  }
};
