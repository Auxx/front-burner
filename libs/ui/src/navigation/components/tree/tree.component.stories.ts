import { signal } from '@angular/core';
import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { IslandComponent } from '../../../layout/components/island/island.component';
import { MenuTriggerDirective } from '../../directives/menu-trigger/menu-trigger.directive';
import { TreeItemMenuDirective } from '../../directives/tree-item-menu/tree-item-menu.directive';
import { TreeNodeDirective } from '../../directives/tree-node/tree-node.directive';
import type { TreeNode } from '../../models/tree-node.model';
import { MenuItemComponent } from '../menu-item/menu-item.component';
import { MenuComponent } from '../menu/menu.component';
import { TreeComponent } from './tree.component';

// Codicon `ellipsis` (CC-BY-4.0), inline until the Icon component exists.
const ellipsis =
  'M5 8C5 8.55229 4.55228 9 4 9C3.44772 9 3 8.55229 3 8C3 7.44772 3.44772 7 4 7C4.55228 7 5 7.44772 5 8ZM9 8C9 8.55229 8.55229 9 8 9C7.44772 9 7 8.55229 7 8C7 7.44772 7.44772 7 8 7C8.55229 7 9 7.44772 9 8ZM12 9C12.5523 9 13 8.55229 13 8C13 7.44772 12.5523 7 12 7C11.4477 7 11 7.44772 11 8C11 8.55229 11.4477 9 12 9Z';

const meta: Meta<TreeComponent> = {
  title: 'Navigation/Tree',
  component: TreeComponent,
  parameters: { layout: 'fullscreen' },
  decorators: [
    story => ({
      ...story(),
      moduleMetadata: {
        imports: [
          IslandComponent,
          MenuComponent,
          MenuItemComponent,
          MenuTriggerDirective,
          TreeItemMenuDirective,
          TreeNodeDirective
        ]
      }
    })
  ]
};

export default meta;

type Story = StoryObj<TreeComponent>;

const styles = [
  '.canvas { display: grid; block-size: 30rem; max-inline-size: 20rem; padding: var(--ui-island-gap); }',
  '.name { flex: 1; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }'
];

const repository: readonly TreeNode[] = [
  {
    value: '.github',
    label: '.github',
    expandable: true,
    children: [
      {
        value: '.github/workflows',
        label: 'workflows',
        expandable: true,
        children: [ { value: '.github/workflows/ci.yml', label: 'ci.yml' } ]
      }
    ]
  },
  {
    value: 'docs',
    label: 'docs',
    expandable: true,
    children: [
      { value: 'docs/getting-started.md', label: 'getting-started.md' },
      { value: 'docs/guide.md', label: 'guide.md' }
    ]
  },
  { value: 'README.md', label: 'README.md' },
  { value: '.gitignore', label: '.gitignore' }
];

/** The file tree of a repository (REQ-FILE-001), with row actions. */
export const FileTree: Story = {
  render: () => ({
    props: { nodes: repository, ellipsis },
    styles: [
      ...styles,
      `.actions {
        display: inline-flex; flex: none; align-items: center; justify-content: center;
        inline-size: var(--ui-control-height-small); block-size: var(--ui-control-height-small);
        padding: 0; color: var(--ui-icon-muted); background: none; border: 0; border-radius: var(--ui-radius-control);
        cursor: pointer;
      }`,
      '.actions:hover { color: var(--ui-icon-default); background: var(--ui-surface-hover); }',
      '.actions svg { inline-size: var(--ui-icon-size); block-size: var(--ui-icon-size); }'
    ],
    template: `
      <div class="canvas">
        <ui-island heading="Files" [scrollable]="false">
          <ui-tree label="Files" [nodes]="nodes">
            <ng-template uiTreeNode let-node>
              <span class="name">{{ node.label }}</span>
              <button class="actions" uiTreeItemMenu [uiMenuTrigger]="actions.aria" aria-label="Actions for {{ node.label }}">
                <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path [attr.d]="ellipsis" /></svg>
              </button>
            </ng-template>
          </ui-tree>
        </ui-island>
      </div>
      <ui-menu #actions="uiMenu">
        <button uiMenuItem="rename">Rename</button>
        <button uiMenuItem="delete">Delete</button>
      </ui-menu>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tree = canvas.getByRole('tree', { name: 'Files' });
    const docs = canvas.getByRole('treeitem', { name: 'docs' });

    await userEvent.tab();
    await expect(tree).toHaveFocus();
    await expect(tree).toHaveAttribute('aria-activedescendant', canvas.getByRole('treeitem', { name: '.github' }).id);

    await userEvent.keyboard('{ArrowDown}');
    await expect(tree).toHaveAttribute('aria-activedescendant', docs.id);

    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(docs).toHaveAttribute('aria-expanded', 'true'));
    await expect(await canvas.findByRole('treeitem', { name: 'guide.md' })).toBeVisible();
  }
};

/** A folder whose children arrive 300 ms after it is expanded (FB-15). */
export const LazyFolder: Story = {
  render: () => {
    const nodes = signal<readonly TreeNode[]>([
      { value: 'notes', label: 'notes', expandable: true },
      { value: 'README.md', label: 'README.md' }
    ]);
    const setChildren = (value: string, children: readonly TreeNode[]) =>
      nodes.update(list => list.map(node => node.value === value ? { ...node, children } : node));
    const load = (value: string) => {
      setChildren(value, [ { value: `${value}/…`, label: 'Loading…', selectable: false } ]);
      setTimeout(
        () =>
          setChildren(
            value,
            [ 'ideas.md', 'journal.md', 'todo.md' ].map(name => ({ value: `${value}/${name}`, label: name }))
          ),
        300
      );
    };
    return {
      props: { nodes, load },
      styles,
      template: `
        <div class="canvas">
          <ui-island heading="Files" [scrollable]="false">
            <ui-tree label="Files" [nodes]="nodes()" (loadChildren)="load($event)" />
          </ui-island>
        </div>
      `
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('treeitem', { name: 'notes' }));
    await expect(canvas.getByRole('treeitem', { name: 'Loading…' })).toBeVisible();

    await expect(await canvas.findByRole('treeitem', { name: 'todo.md' })).toBeVisible();
    await expect(canvas.queryByRole('treeitem', { name: 'Loading…' })).toBeNull();
  }
};

const largeFolder: readonly TreeNode[] = [
  {
    value: 'archive',
    label: 'archive',
    expandable: true,
    children: Array.from({ length: 5000 }, (_, index) => {
      const name = `file-${String(index + 1).padStart(4, '0')}.md`;
      return { value: `archive/${name}`, label: name };
    })
  }
];

/**
 * A folder of 5,000 files, the most a listing returns (FB-18). Only the rows
 * near the viewport are rendered (A-10.34): opening the folder shows its first
 * screen of rows within 300 ms (NF-2.1), and End reaches the last file.
 */
export const LargeFolder: Story = {
  render: () => ({
    props: { nodes: largeFolder },
    styles,
    template: `
      <div class="canvas">
        <ui-island heading="Files" [scrollable]="false">
          <ui-tree label="Files" [nodes]="nodes" />
        </ui-island>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tree = canvas.getByRole('tree', { name: 'Files' });
    const folder = canvas.getByRole('treeitem', { name: 'archive' });
    const rows = () => canvasElement.querySelectorAll('[role="treeitem"]');
    const screenful = Math.floor(tree.clientHeight / folder.offsetHeight);

    const start = performance.now();
    await userEvent.click(folder);
    await waitFor(() => expect(rows().length).toBeGreaterThanOrEqual(screenful), { timeout: 10_000, interval: 5 });
    const elapsed = performance.now() - start;
    console.log(`LargeFolder: first ${screenful} of 5,001 rows rendered in ${Math.round(elapsed)} ms`);
    await expect(elapsed).toBeLessThan(300);
    await expect(rows().length).toBeLessThan(200);

    await userEvent.keyboard('{End}');
    const last = await canvas.findByRole('treeitem', { name: 'file-5000.md' });
    await expect(tree).toHaveAttribute('aria-activedescendant', last.id);
  }
};
