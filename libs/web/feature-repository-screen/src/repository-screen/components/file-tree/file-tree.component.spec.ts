import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CurrentUser, FolderListing } from '@front-burner/shared-contracts';
import { FilesApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { type Observable, of, throwError } from 'rxjs';

import { entry, folder, listing } from '../../../testing/listings';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { restoreLayout, stubViewportLayout } from '../../../testing/viewport-layout';
import { FileTreeStoreService } from '../../services/file-tree-store/file-tree-store.service';
import { type EntryActionRequest, FileTreeComponent } from './file-tree.component';

const K = 'web-feature-repository-screen.FileTreeComponent';

const ada: CurrentUser = {
  id: 4,
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  role: 'user',
  allowedGitLevels: [ 'advanced' ]
};

@Component({
  imports: [ FileTreeComponent ],
  template:
    `<rs-file-tree
      [selected]="selected()"
      (selectPath)="selects.push($event)"
      (retry)="retries.push($event)"
      (action)="actions.push($event)"
    />`
})
class HostComponent {
  readonly selected = signal<string | null>(null);
  readonly selects: string[] = [];
  readonly retries: string[] = [];
  readonly actions: EntryActionRequest[] = [];
}

describe('FileTreeComponent', () => {
  let folders: Record<string, FolderListing>;
  let answers: Record<string, Observable<FolderListing>[]>;
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const root = () => fixture.nativeElement as HTMLElement;
  const row = (name: string) =>
    [ ...root().querySelectorAll<HTMLElement>('[role="treeitem"]') ].find(item =>
      item.getAttribute('aria-label')?.startsWith(name)
    ) as HTMLElement;
  /** The icons of a row, without its actions button's. */
  const icons = (item: HTMLElement) =>
    [ ...item.querySelectorAll('use') ].filter(use => !use.closest('.actions')).map(use =>
      use.getAttribute('href')?.split('#')[1]
    );
  const actionsButton = (name: string) => row(name).querySelector<HTMLButtonElement>('button.actions');
  const menuItems = () =>
    [ ...document.querySelectorAll('.cdk-overlay-container [role="menuitem"]') ].map(item => item.textContent?.trim());
  const tree = () => root().querySelector('[role="tree"]') as HTMLElement;
  const press = (key: string, init: KeyboardEventInit = {}) =>
    tree().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  const tooltips = () => [ ...document.querySelectorAll('ui-tooltip') ].map(element => element.textContent?.trim());

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    TestBed.inject(FileTreeStoreService).init(12);
    await settle(fixture);
    await settle(fixture);
  }

  beforeAll(stubViewportLayout);
  afterAll(restoreLayout);

  beforeEach(() => {
    localStorage.clear();
    answers = {};
    folders = {
      '': listing('', [
        folder('build', { ignored: true }),
        folder('docs'),
        entry('debug.log', { ignored: true }),
        entry('guide.md'),
        entry('logo.png'),
        entry('latest', { kind: 'symlink', size: null }),
        entry('vendor', { kind: 'submodule', size: null })
      ]),
      build: listing('build', [], { ignored: true }),
      docs: listing('docs', [ entry('intro.md') ])
    };
    TestBed.configureTestingModule({
      imports: [ HostComponent, translocoTesting() ],
      providers: [
        FileTreeStoreService,
        {
          provide: FilesApi,
          useValue: {
            listFolder: (_id: number, query: { path: string; }) =>
              answers[query.path]?.shift() ?? of(folders[query.path])
          }
        },
        { provide: CurrentUserService, useValue: { user: signal(ada), load: () => Promise.resolve(ada) } }
      ]
    });
  });

  afterEach(() => localStorage.clear());

  it('renders kinds with their icons', async () => {
    await create();

    expect(root().querySelector('[role="tree"]')?.getAttribute('aria-label')).toBe(`${K}.label`);
    expect(icons(row('docs'))).toEqual([ 'chevron-right', 'folder' ]);
    expect(icons(row('guide.md'))).toEqual([ 'markdown' ]);
    expect(icons(row('logo.png'))).toEqual([ 'file' ]);
    expect(icons(row('latest'))).toEqual([ 'file-symlink-file' ]);
    expect(icons(row('vendor'))).toEqual([ 'file-submodule' ]);
  });

  it('marks ignored entries with the colour and the icon', async () => {
    await create();

    for (const name of [ 'build', 'debug.log' ]) {
      expect(row(name).querySelector('.name')?.classList).toContain('ignored');
      expect(icons(row(name))).toContain('diff-ignored');
      // No "ignored" word after the name (FB-20a).
      expect(row(name).textContent?.trim()).toBe(name);
    }
    expect(row('guide.md').querySelector('.name')?.classList).not.toContain('ignored');
    expect(row('guide.md').querySelector('.ignored-icon')).toBeNull();
  });

  it('shows the ignored message without selecting the row', async () => {
    await create();

    (row('debug.log').querySelector('.ignored-icon') as HTMLElement).click();
    await settle(fixture);

    expect(tooltips()).toEqual([ `${K}.ignoredFile` ]);
    expect(host.selects).toEqual([]);
    expect(row('debug.log').getAttribute('aria-selected')).toBe('false');

    (row('build').querySelector('.ignored-icon') as HTMLElement).click();
    await settle(fixture);

    expect(tooltips()).toEqual([ `${K}.ignoredFolder` ]);
    expect(row('build').getAttribute('aria-expanded')).toBe('false');
  });

  it('selects files and toggles folders', async () => {
    await create();

    row('guide.md').click();
    row('docs').click();
    await settle(fixture);

    expect(host.selects).toEqual([ 'guide.md' ]);
    expect(row('docs').getAttribute('aria-expanded')).toBe('true');
    expect(row('intro.md')).toBeDefined();
  });

  it('selects the open file again, such as to close the drawer', async () => {
    await create();
    host.selected.set('guide.md');
    await settle(fixture);

    row('guide.md').click();
    await settle(fixture);

    expect(host.selects).toEqual([ 'guide.md' ]);
  });

  it('keeps the focus on the tree when the ignored icon is pressed', async () => {
    await create();
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

    (row('debug.log').querySelector('.ignored-icon') as HTMLElement).dispatchEvent(press);

    expect(press.defaultPrevented).toBe(true);
  });

  it('highlights the selected path', async () => {
    await create();

    host.selected.set('guide.md');
    await settle(fixture);

    expect(row('guide.md').getAttribute('aria-selected')).toBe('true');
  });

  it('emits retry for the error row', async () => {
    answers['docs'] = [
      throwError(() => new HttpErrorResponse({ status: 500, error: { code: 'internal', params: {}, requestId: '' } }))
    ];
    await create();
    host.selected.set('guide.md');
    row('docs').click();
    await settle(fixture);

    const error = root().querySelector<HTMLElement>('[role="treeitem"][aria-level="2"]') as HTMLElement;
    expect(error.textContent).toContain('web-feature-repository-screen.FileTreeStoreService.loadFailed');
    expect(error.textContent).toContain(`${K}.retry`);

    error.click();
    await settle(fixture);

    expect(host.retries).toEqual([ 'docs' ]);
    expect(host.selects).toEqual([]);
    // The open file stays selected.
    expect(row('guide.md').getAttribute('aria-selected')).toBe('true');
  });

  it('does not expand a submodule', async () => {
    await create();

    row('vendor').click();
    await settle(fixture);

    expect(row('vendor').hasAttribute('aria-expanded')).toBe(false);
    expect(host.selects).toEqual([ 'vendor' ]);
  });

  describe('actions', () => {
    it('shows an actions button only on entries with actions', async () => {
      await create();

      expect(actionsButton('docs')?.getAttribute('aria-label')).toBe(`${K}.actionsFor`);
      expect(actionsButton('docs')?.getAttribute('tabindex')).toBe('-1');
      expect(actionsButton('guide.md')).not.toBeNull();
      for (const name of [ 'logo.png', 'latest', 'vendor' ]) {
        expect(actionsButton(name)).toBeNull();
      }
    });

    it('emits the root actions from the buttons above the tree', async () => {
      await create();
      const toolbar = [ ...root().querySelectorAll<HTMLButtonElement>('.toolbar button') ];

      expect(toolbar.map(button => button.getAttribute('aria-label'))).toEqual([ `${K}.newFile`, `${K}.newFolder` ]);
      toolbar.forEach(button => button.click());

      expect(host.actions).toEqual([ { action: 'new-file', path: '' }, { action: 'new-folder', path: '' } ]);
    });

    it('lists the actions of the row that opened the menu', async () => {
      await create();

      actionsButton('docs')?.click();
      await settle(fixture);
      await settle(fixture);

      expect(menuItems()).toEqual([ `${K}.actions.new-file`, `${K}.actions.new-folder`, `${K}.actions.rename` ]);
      expect(host.selects).toEqual([]);
      expect(row('docs').getAttribute('aria-expanded')).toBe('false');

      (document.querySelectorAll<HTMLElement>('.cdk-overlay-container [role="menuitem"]')[1]).click();
      await settle(fixture);

      expect(host.actions).toEqual([ { action: 'new-folder', path: 'docs' } ]);
    });

    it('opens the actions menu from the keyboard', async () => {
      await create();
      tree().focus();
      await settle(fixture);
      // From `build` to `guide.md`: docs, debug.log, guide.md.
      press('ArrowDown');
      press('ArrowDown');
      press('ArrowDown');
      await settle(fixture);

      press('F10', { shiftKey: true });
      await settle(fixture);
      await settle(fixture);

      expect(menuItems()).toEqual([ `${K}.actions.rename` ]);
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
      await settle(fixture);

      expect(host.actions).toEqual([ { action: 'rename', path: 'guide.md' } ]);
    });
  });
});
