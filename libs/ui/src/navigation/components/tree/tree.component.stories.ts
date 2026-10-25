import { signal } from '@angular/core';
import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { IconComponent } from '../../../content/components/icon/icon.component';
import { IslandComponent } from '../../../layout/components/island/island.component';
import { MenuTriggerDirective } from '../../directives/menu-trigger/menu-trigger.directive';
import { TreeItemMenuDirective } from '../../directives/tree-item-menu/tree-item-menu.directive';
import { TreeNodeDirective } from '../../directives/tree-node/tree-node.directive';
import type { TreeNode } from '../../models/tree-node.model';
import { MenuItemComponent } from '../menu-item/menu-item.component';
import { MenuComponent } from '../menu/menu.component';
import { TreeComponent } from './tree.component';

const meta: Meta<TreeComponent> = {
  title: 'Navigation/Tree',
  component: TreeComponent,
  parameters: { layout: 'fullscreen' },
  decorators: [
    story => ({
      ...story(),
      moduleMetadata: {
        imports: [
          IconComponent,
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
    props: { nodes: repository },
    styles: [
      ...styles,
      `.actions {
        display: inline-flex; flex: none; align-items: center; justify-content: center;
        inline-size: var(--ui-control-height-small); block-size: var(--ui-control-height-small);
        padding: 0; color: var(--ui-icon-muted); background: none; border: 0; border-radius: var(--ui-radius-control);
        cursor: pointer;
      }`,
      '.actions:hover { color: var(--ui-icon-default); background: var(--ui-surface-hover); }'
    ],
    template: `
      <div class="canvas">
        <ui-island heading="Files" [scrollable]="false">
          <ui-tree label="Files" [nodes]="nodes">
            <ng-template uiTreeNode let-node>
              <span class="name">{{ node.label }}</span>
              <button class="actions" uiTreeItemMenu [uiMenuTrigger]="actions.aria" aria-label="Actions for {{ node.label }}">
                <ui-icon name="ellipsis" />
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

/**
 * Right-to-left text: a collapsed folder's chevron points to the inline start,
 * and an expanded folder's points down.
 */
export const RightToLeft: Story = {
  render: () => ({
    props: { nodes: repository },
    styles,
    template: `
      <div class="canvas" dir="rtl">
        <ui-island heading="Files" [scrollable]="false">
          <ui-tree label="Files" [nodes]="nodes" />
        </ui-island>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const docs = canvas.getByRole('treeitem', { name: 'docs' });
    const chevron = (item: HTMLElement) => getComputedStyle(item.querySelector('.chevron > ui-icon') as Element);

    await userEvent.click(docs);
    await waitFor(() => expect(docs).toHaveAttribute('aria-expanded', 'true'));

    await expect(chevron(canvas.getByRole('treeitem', { name: '.github' })).scale).toBe('-1 1');
    // The chevron turns with a transition.
    await waitFor(() => expect(chevron(docs).rotate).toBe('-90deg'));
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

const manyFiles: readonly TreeNode[] = Array.from({ length: 80 }, (_, index) => {
  const name = `note-${String(index + 1).padStart(2, '0')}.md`;
  return { value: name, label: name };
});

/**
 * A tree in a hidden pane whose rows change while the density switches to
 * touch, as when a hidden tab is refreshed (FB-41) on a phone. Shown again, it
 * lays its rows out at their own height: they do not overlap when scrolled,
 * and End brings the last one fully into view.
 */
export const HiddenWhileRowsChange: Story = {
  render: () => {
    const hidden = signal(false);
    const nodes = signal<readonly TreeNode[]>(manyFiles);
    const addFile = () => nodes.update(list => [ ...list, { value: 'note-81.md', label: 'note-81.md' } ]);
    return {
      props: { hidden, nodes, addFile },
      styles: [
        ...styles,
        '.canvas { grid-template-rows: auto auto 1fr; gap: var(--ui-space-2); }',
        '.pane:not([hidden]) { display: grid; min-block-size: 0; }'
      ],
      template: `
        <div class="canvas">
          <button type="button" (click)="hidden.set(!hidden())">{{ hidden() ? 'Show files' : 'Hide files' }}</button>
          <button type="button" (click)="addFile()">Add a file</button>
          <div class="pane" [hidden]="hidden()">
            <ui-island heading="Files" [scrollable]="false">
              <ui-tree label="Files" [nodes]="nodes()" />
            </ui-island>
          </div>
        </div>
      `
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const root = document.documentElement;
    const density = root.getAttribute('data-density');
    const rows = () => [ ...canvasElement.querySelectorAll<HTMLElement>('[role="treeitem"]') ];

    try {
      await userEvent.click(canvas.getByRole('button', { name: 'Hide files' }));
      root.setAttribute('data-density', 'touch');
      await userEvent.click(canvas.getByRole('button', { name: 'Add a file' }));
      await userEvent.click(canvas.getByRole('button', { name: 'Show files' }));

      const tree = canvas.getByRole('tree', { name: 'Files' });
      const rowHeight = (await canvas.findByRole('treeitem', { name: 'note-01.md' })).getBoundingClientRect().height;
      // The CDK's scroll height is the number of rows times its row pitch.
      await waitFor(() => expect(tree.scrollHeight / 81).toBeCloseTo(rowHeight, 1));

      tree.focus();
      await userEvent.keyboard('{End}');
      const last = await canvas.findByRole('treeitem', { name: 'note-81.md' });
      await waitFor(() => {
        const box = last.getBoundingClientRect();
        const view = tree.getBoundingClientRect();
        expect(box.top).toBeGreaterThanOrEqual(view.top - 0.5);
        expect(box.bottom).toBeLessThanOrEqual(view.bottom + 0.5);
      });
      const boxes = rows().map(row => row.getBoundingClientRect());
      for (let i = 1; i < boxes.length; i++) {
        await expect(boxes[i].top).toBeGreaterThanOrEqual(boxes[i - 1].bottom - 0.5);
      }
    } finally {
      if (density === null) {
        root.removeAttribute('data-density');
      } else {
        root.setAttribute('data-density', density);
      }
    }
  }
};
