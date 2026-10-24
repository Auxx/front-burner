import { MenuHarness } from '@angular/aria/menu/testing';
import { Dir } from '@angular/cdk/bidi';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MenuTriggerDirective } from '../../directives/menu-trigger/menu-trigger.directive';
import { TreeItemMenuDirective } from '../../directives/tree-item-menu/tree-item-menu.directive';
import { TreeNodeDirective } from '../../directives/tree-node/tree-node.directive';
import type { TreeNode } from '../../models/tree-node.model';
import { MenuItemComponent } from '../menu-item/menu-item.component';
import { MenuComponent } from '../menu/menu.component';
import { TreeComponent } from './tree.component';

class UiMenuHarness extends MenuHarness {
  static override hostSelector = 'ui-menu';
}

const NODES: readonly TreeNode[] = [
  {
    value: 'docs',
    label: 'docs',
    expandable: true,
    children: [
      {
        value: 'docs/guides',
        label: 'guides',
        expandable: true,
        children: [ { value: 'docs/guides/setup.md', label: 'setup.md' } ]
      },
      { value: 'docs/intro.md', label: 'intro.md' }
    ]
  },
  { value: 'src', label: 'src', expandable: true },
  { value: 'README.md', label: 'README.md', accessibleName: 'README.md, Markdown file' },
  { value: 'CHANGELOG.md', label: 'CHANGELOG.md' }
];

@Component({
  imports: [
    MenuComponent,
    MenuItemComponent,
    MenuTriggerDirective,
    TreeComponent,
    TreeItemMenuDirective,
    TreeNodeDirective
  ],
  template: `
    <ui-tree
      label="Files"
      [nodes]="nodes()"
      [(selected)]="selected"
      [(expanded)]="expanded"
      (loadChildren)="requested.push($event)"
    >
      <ng-template uiTreeNode let-node>
        <span>{{ node.label }}</span>
        <button uiTreeItemMenu [uiMenuTrigger]="menu.aria" aria-label="Actions for {{ node.label }}"></button>
      </ng-template>
    </ui-tree>
    <ui-menu #menu="uiMenu">
      <button uiMenuItem="rename">Rename</button>
    </ui-menu>
    <button>Outside</button>
  `
})
class HostComponent {
  readonly nodes = signal<readonly TreeNode[]>(NODES);
  readonly selected = signal<string | null>(null);
  readonly expanded = signal<readonly string[]>([]);
  readonly requested: string[] = [];
}

@Component({
  imports: [ Dir, TreeComponent ],
  template: `<div dir="rtl"><ui-tree label="Files" [nodes]="nodes" [(expanded)]="expanded" /></div>`
})
class RtlHostComponent {
  readonly nodes = NODES;
  readonly expanded = signal<readonly string[]>([]);
}

const LARGE: readonly TreeNode[] = Array.from({ length: 5000 }, (_, index) => ({
  value: `file-${index + 1}.md`,
  label: `file-${index + 1}.md`
}));

@Component({
  imports: [ TreeComponent ],
  template: `<ui-tree label="Files" [nodes]="nodes" />`
})
class LargeHostComponent {
  readonly nodes = LARGE;
}

// jsdom has no layout: the virtual scroll viewport gets a height of 10 rows of
// 24 px, and a `scrollTop` that remembers its value and fires `scroll`, so
// that the CDK renders the rows near the scroll position.
const VIEWPORT = 'CDK-VIRTUAL-SCROLL-VIEWPORT';
const scrollTops = new WeakMap<Element, number>();
const elementScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop') as PropertyDescriptor;
const elementClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight') as PropertyDescriptor;

function stubViewportLayout(): void {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === VIEWPORT ? 240 : elementClientHeight.get?.call(this);
    }
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === VIEWPORT ? scrollTops.get(this) ?? 0 : elementScrollTop.get?.call(this);
    },
    set(this: HTMLElement, value: number) {
      if (this.tagName === VIEWPORT) {
        scrollTops.set(this, value);
        this.dispatchEvent(new Event('scroll'));
      } else {
        elementScrollTop.set?.call(this, value);
      }
    }
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      if (options.top != null) {
        this.scrollTop = options.top;
      }
    }
  });
}

function restoreLayout(): void {
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop');
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
}

describe('TreeComponent', () => {
  let fixture: ComponentFixture<unknown>;

  const root = () => fixture.nativeElement as HTMLElement;
  const tree = () => root().querySelector('[role="tree"]') as HTMLElement;
  const rows = () => [ ...root().querySelectorAll('[role="treeitem"]') ] as HTMLElement[];
  const row = (label: string) => rows().find(el => el.textContent?.trim() === label) as HTMLElement;
  const active = () => tree().getAttribute('aria-activedescendant');
  const menuButton = (label: string) =>
    root().querySelector(`[aria-label="Actions for ${label}"]`) as HTMLButtonElement;
  const outside = () =>
    [ ...root().querySelectorAll('button') ].find(b => b.textContent?.trim() === 'Outside') as HTMLElement;
  const menuOpen = () => document.querySelector('.cdk-overlay-container ui-menu') !== null;

  // The CDK renders after a microtask and an animation frame.
  const stable = async () => {
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 40));
    await fixture.whenStable();
  };
  const press = async (key: string, init: KeyboardEventInit = {}, target = document.activeElement as HTMLElement) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    await stable();
  };
  const enter = async () => {
    (outside() ?? document.activeElement as HTMLElement | null)?.focus();
    (document.activeElement as HTMLElement | null)?.blur();
    tree().focus();
    await stable();
  };
  const activate = async (label: string) => {
    await enter();
    await press('Home');
    for (let i = 0; i < 20 && active() !== row(label)?.id; i++) {
      await press('ArrowDown');
    }
    expect(active()).toBe(row(label).id);
  };

  let host: HostComponent;
  const create = async (setUp: (host: HostComponent) => void = () => undefined) => {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance as HostComponent;
    setUp(host);
    await stable();
  };

  const restore = (h: HostComponent) => {
    h.expanded.set([ 'docs', 'docs/guides' ]);
    h.selected.set('docs/guides/setup.md');
  };

  beforeAll(stubViewportLayout);
  afterAll(restoreLayout);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ HostComponent, RtlHostComponent, LargeHostComponent ] })
      .compileComponents();
  });

  it('is a labelled tree of flat, levelled rows', async () => {
    await create(restore);

    expect(tree().getAttribute('aria-label')).toBe('Files');
    expect(rows().map(el => el.getAttribute('aria-level'))).toEqual([ '1', '2', '3', '2', '1', '1', '1' ]);
    expect(row('README.md').getAttribute('aria-setsize')).toBe('4');
    expect(row('README.md').getAttribute('aria-posinset')).toBe('3');
    expect(row('intro.md').getAttribute('aria-setsize')).toBe('2');
    expect(row('intro.md').getAttribute('aria-posinset')).toBe('2');
    // Rows are siblings: no row holds another.
    expect(rows().every(el => el.querySelector('[role="treeitem"]') === null)).toBe(true);
  });

  it('names rows by their accessible name, else their label', async () => {
    await create();

    expect(row('README.md').getAttribute('aria-label')).toBe('README.md, Markdown file');
    expect(row('CHANGELOG.md').getAttribute('aria-label')).toBe('CHANGELOG.md');
  });

  it('marks state only where it applies', async () => {
    await create(h => h.selected.set('README.md'));

    expect(row('docs').getAttribute('aria-expanded')).toBe('false');
    expect(row('docs').hasAttribute('aria-selected')).toBe(false);
    expect(row('README.md').hasAttribute('aria-expanded')).toBe(false);
    expect(row('README.md').getAttribute('aria-selected')).toBe('true');
    expect(row('CHANGELOG.md').getAttribute('aria-selected')).toBe('false');
  });

  it('renders children only once a folder is expanded', async () => {
    await create();
    expect(row('intro.md')).toBeUndefined();

    row('docs').click();
    await stable();

    expect(host.expanded()).toEqual([ 'docs' ]);
    expect(row('intro.md').getAttribute('aria-level')).toBe('2');
    expect(document.activeElement).toBe(tree());
    expect(active()).toBe(row('docs').id);
  });

  it('asks for children it does not have', async () => {
    await create();

    row('src').click();
    await stable();
    expect(host.requested).toEqual([ 'src' ]);

    row('docs').click();
    await stable();
    expect(host.requested).toEqual([ 'src' ]);

    host.nodes.set(
      NODES.map(node =>
        node.value === 'src' ? { ...node, children: [ { value: 'src/main.ts', label: 'main.ts' } ] } : node
      )
    );
    await stable();
    expect(row('main.ts')).toBeDefined();
  });

  it('opens a file with a click', async () => {
    await create();

    row('README.md').click();
    await stable();

    expect(host.selected()).toBe('README.md');
  });

  it('restores expanded folders and the open file', async () => {
    await create(restore);

    expect(row('setup.md').getAttribute('aria-level')).toBe('3');
    expect(row('setup.md').getAttribute('aria-selected')).toBe('true');
  });

  it('focuses the open file when tabbed into', async () => {
    await create(restore);

    await enter();
    expect(active()).toBe(row('setup.md').id);

    // After the user moved around and left the tree, it returns there.
    await press('Home');
    expect(active()).toBe(row('docs').id);
    await enter();

    expect(active()).toBe(row('setup.md').id);
  });

  it('returns to the last active row when no file is open', async () => {
    await create();

    await enter();
    expect(active()).toBe(row('docs').id);
    await press('End');
    await enter();

    expect(active()).toBe(row('CHANGELOG.md').id);
  });

  it('opens a file with Enter and toggles a folder with Enter or Space', async () => {
    await create();

    await activate('README.md');
    await press('Enter');
    expect(host.selected()).toBe('README.md');

    await activate('docs');
    await press('Enter');
    expect(host.expanded()).toEqual([ 'docs' ]);
    expect(host.selected()).toBe('README.md');

    await press(' ');
    expect(host.expanded()).toEqual([]);
  });

  it('moves, expands and collapses with the arrow keys', async () => {
    await create();

    await activate('docs');
    await press('ArrowRight');
    expect(host.expanded()).toEqual([ 'docs' ]);
    expect(active()).toBe(row('docs').id);

    await press('ArrowRight');
    expect(active()).toBe(row('guides').id);

    await press('ArrowLeft');
    expect(active()).toBe(row('docs').id);

    await press('ArrowLeft');
    expect(host.expanded()).toEqual([]);

    await press('ArrowUp');
    expect(active()).toBe(row('docs').id);
    await press('ArrowDown');
    expect(active()).toBe(row('src').id);
  });

  it('swaps left and right in right-to-left text', async () => {
    fixture = TestBed.createComponent(RtlHostComponent);
    const rtl = fixture.componentInstance as RtlHostComponent;
    await stable();

    await enter();
    await press('ArrowLeft');
    expect(rtl.expanded()).toEqual([ 'docs' ]);

    await press('ArrowRight');
    expect(rtl.expanded()).toEqual([]);
  });

  it('finds rows by typing the start of their label', async () => {
    await create();
    await enter();

    await press('c');
    expect(active()).toBe(row('CHANGELOG.md').id);

    await press('r');
    await new Promise(resolve => setTimeout(resolve, 600));
    await press('s');
    expect(active()).toBe(row('src').id);
  });

  it('opens the row actions menu from the keyboard and keeps navigating', async () => {
    await create();
    const menu = await TestbedHarnessEnvironment.documentRootLoader(fixture).getHarness(UiMenuHarness);

    await activate('README.md');
    await press('F10', { shiftKey: true });
    expect(await menu.isOpen()).toBe(true);
    expect(menuOpen()).toBe(true);

    await press('Escape');
    expect(await menu.isOpen()).toBe(false);
    expect(document.activeElement).toBe(tree());
    expect(active()).toBe(row('README.md').id);

    await press('ArrowDown');
    expect(active()).toBe(row('CHANGELOG.md').id);
    expect(document.activeElement).toBe(tree());

    await press('ContextMenu');
    expect(await menu.isOpen()).toBe(true);
    expect(menuButton('CHANGELOG.md').getAttribute('aria-expanded')).toBe('true');
  });

  it('does not select or toggle a row when its menu button is clicked', async () => {
    await create();

    menuButton('docs').click();
    await stable();

    expect(host.expanded()).toEqual([]);
    expect(host.selected()).toBeNull();
    expect(menuOpen()).toBe(true);
  });

  it('keeps a row menu and its triggers consistent when rows are added', async () => {
    await create();
    const expandedButtons = () =>
      [ ...root().querySelectorAll('[uiTreeItemMenu]') ].filter(b => b.getAttribute('aria-expanded') === 'true');

    menuButton('README.md').click();
    await stable();
    expect(menuOpen()).toBe(true);

    host.nodes.set([ ...NODES, { value: 'LICENSE', label: 'LICENSE' } ]);
    await stable();

    expect(row('LICENSE')).toBeDefined();
    expect(menuOpen()).toBe(true);
    expect(expandedButtons()).toEqual([ menuButton('README.md') ]);
  });

  it('closes a row menu whose row is scrolled away', async () => {
    await create(h =>
      h.nodes.set(Array.from({ length: 200 }, (_, index) => ({ value: `f${index}`, label: `f${index}` })))
    );

    menuButton('f0').click();
    await stable();
    expect(menuOpen()).toBe(true);

    tree().scrollTop = 150 * 24;
    await stable();

    expect(row('f0')).toBeUndefined();
    expect(menuOpen()).toBe(false);
    expect([ ...root().querySelectorAll('[uiTreeItemMenu]') ].some(b => b.getAttribute('aria-expanded') === 'true'))
      .toBe(false);
  });

  it('does not scroll when a pointer focuses the tree', async () => {
    fixture = TestBed.createComponent(LargeHostComponent);
    await stable();
    tree().scrollTop = 100 * 24;
    await stable();
    const target = row('file-105.md');

    // A tap: pointerdown at touchstart, then the compatibility mousedown and the
    // focus well after it.
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 50));
    // `buttons` and `detail` are 0 in a screen reader's fake mousedown.
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, buttons: 1, detail: 1 }));
    tree().focus();
    await stable();

    expect(tree().scrollTop).toBe(100 * 24);
    target.click();
    await stable();
    expect(active()).toBe(row('file-105.md').id);
  });

  it('keeps the tree as the only tab stop when the active row disappears', async () => {
    await create();
    await activate('CHANGELOG.md');

    host.nodes.set(NODES.filter(node => node.value !== 'CHANGELOG.md'));
    await stable();

    expect(row('CHANGELOG.md')).toBeUndefined();
    expect(tree().tabIndex).toBe(0);
    expect(rows().some(el => el.hasAttribute('tabindex'))).toBe(false);
    expect(menuButton('README.md').tabIndex).toBe(-1);
    // The row now at the same index, clamped to the end.
    expect(active()).toBe(row('README.md').id);
  });

  it('falls back to the open file when the active row disappears', async () => {
    await create(h => h.selected.set('README.md'));
    await activate('CHANGELOG.md');

    host.nodes.set(NODES.filter(node => node.value !== 'CHANGELOG.md'));
    await stable();

    expect(active()).toBe(row('README.md').id);
  });

  it('indents rows by level', async () => {
    await create(restore);
    expect(row('setup.md').style.getPropertyValue('--ui-tree-level')).toBe('3');
  });

  it('shows the label when no row template is given', async () => {
    fixture = TestBed.createComponent(LargeHostComponent);
    await stable();

    expect(rows()[0].textContent?.trim()).toBe('file-1.md');
  });

  it('renders only the rows near the viewport, and reaches the last with End', async () => {
    fixture = TestBed.createComponent(LargeHostComponent);
    await stable();
    expect(rows().length).toBeLessThan(100);

    await enter();
    await press('End');

    const last = row('file-5000.md');
    expect(last).toBeDefined();
    expect(active()).toBe(last.id);
    expect(last.getAttribute('aria-posinset')).toBe('5000');
  });
});
