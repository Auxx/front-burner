import { BreakpointObserver } from '@angular/cdk/layout';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type {
  CurrentUser,
  FileContent,
  FolderListing,
  PushEvent,
  RepositorySummary
} from '@front-burner/shared-contracts';
import { ToastService } from '@front-burner/ui';
import { FilesApi, RepositoriesApi } from '@front-burner/web-api-client';
import type { EditorStateChange } from '@front-burner/web-code-editor';
import { AuthSessionService, CurrentUserService, PageTitleService, PushChannelService } from '@front-burner/web-core';
import { BehaviorSubject, map, Observable, of, Subject, throwError } from 'rxjs';

import { MemoryDraftStore, provideMemoryDrafts } from '../../../testing/drafts';
import { entry, folder, listing } from '../../../testing/listings';
import { fileContent } from '../../../testing/open-files';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { restoreLayout, stubViewportLayout } from '../../../testing/viewport-layout';
import { routes } from '../../repository-screen.routes';
import { RepositorySessionService } from '../../services/repository-session/repository-session.service';

const KEY = 'web-feature-repository-screen.RepositoryScreenPage';

const ada: CurrentUser = {
  id: 4,
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  role: 'user',
  allowedGitLevels: [ 'advanced' ]
};

const handbook: RepositorySummary = {
  id: 12,
  name: 'handbook',
  remote: 'github.com/acme/handbook',
  status: 'ready',
  error: null,
  warnings: [],
  lastAccessedAt: '2026-10-28T10:00:00.000Z'
};

function failure(status: number, code: string): Observable<never> {
  return throwError(() =>
    new HttpErrorResponse({ status, error: { code, params: {}, requestId: 'abcdef1234567890', message: code } })
  );
}

describe('RepositoryScreenPage', () => {
  let answers: Observable<RepositorySummary>[];
  /** The working copy, by folder path. */
  let folders: Record<string, FolderListing>;
  /** Folders whose next listing fails with a server error. */
  let failOnce: Set<string>;
  let open: ReturnType<typeof vi.fn>;
  let createEntry: ReturnType<typeof vi.fn>;
  let readFile: ReturnType<typeof vi.fn<(path: string) => Observable<FileContent>>>;
  let saveFile: ReturnType<typeof vi.fn>;
  let recreateFile: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;
  let narrow: boolean;
  /** The viewport's narrowness, which a test can flip. */
  let viewport: BehaviorSubject<boolean>;
  let events: Subject<PushEvent>;
  /** The folders listed, in order. */
  let listings: string[];
  let drafts: MemoryDraftStore;
  /** The files `fileState` does not find. */
  let gone: Set<string>;

  const page = () => harness.fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [ ...page().querySelectorAll('button') ].find(element => element.textContent?.trim() === text);

  async function visit(url: string): Promise<void> {
    viewport = new BehaviorSubject(narrow);
    TestBed.configureTestingModule({
      imports: [ translocoTesting({ 'errors.internal': 'Something went wrong.' }) ],
      providers: [
        provideRouter([ { path: 'repositories/:id', children: routes } ]),
        { provide: RepositoriesApi, useValue: { open } },
        {
          provide: FilesApi,
          useValue: {
            listFolder: (_id: number, query: { path: string; }) =>
              listings.push(query.path) && failOnce.delete(query.path)
                ? failure(500, 'internal')
                : folders[query.path]
                ? of(folders[query.path])
                : failure(404, 'entry-not-found'),
            createEntry,
            isIgnored: () => of({ ignored: false }),
            readFile: (_id: number, query: { path: string; }) => readFile(query.path),
            fileState: (_id: number, query: { path: string; }) =>
              gone.has(query.path)
                ? failure(404, 'entry-not-found')
                : readFile(query.path).pipe(map(({ hash, size }) => ({ hash, size }))),
            saveFile,
            recreateFile
          }
        },
        { provide: CurrentUserService, useValue: { user: signal(ada), load: () => Promise.resolve(ada) } },
        provideMemoryDrafts(drafts),
        { provide: AuthSessionService, useValue: { loggedIn: signal(true), logout: vi.fn() } },
        { provide: PushChannelService, useValue: { events, reconnected: new Subject<void>() } },
        {
          provide: BreakpointObserver,
          useValue: {
            observe: () => viewport.pipe(map(matches => ({ matches, breakpoints: {} }))),
            isMatched: () => viewport.value
          }
        }
      ]
    });
    harness = await RouterTestingHarness.create();
    await go(url);
  }

  async function go(url: string): Promise<void> {
    await harness.navigateByUrl(url);
    await settle(harness.fixture);
    await settle(harness.fixture);
  }

  beforeAll(stubViewportLayout);
  afterAll(restoreLayout);

  beforeEach(() => {
    drafts = new MemoryDraftStore();
    answers = [];
    failOnce = new Set();
    folders = {
      '': listing('', [
        folder('docs'),
        entry('latest', { kind: 'symlink', size: null }),
        entry('logo.png'),
        entry('README.md'),
        entry('vendor', { kind: 'submodule', size: null })
      ]),
      docs: listing('docs', [ entry('guide.md') ])
    };
    narrow = false;
    events = new Subject();
    listings = [];
    localStorage.clear();
    open = vi.fn((id: number) => answers.shift() ?? of({ ...handbook, id }));
    createEntry = vi.fn((_id: number, request: { name: string; }) => of({ path: `${request.name}.md` }));
    readFile = vi.fn((path: string) => of(fileContent(path)));
    gone = new Set();
    saveFile = vi.fn(() => of({ hash: 'b'.repeat(64), size: 10 }));
    recreateFile = vi.fn(() => of({ hash: 'd'.repeat(64), size: 10 }));
    document.title = '';
  });

  it('opens once per repository visit', async () => {
    await visit('/repositories/12');
    await go('/repositories/12/files/docs/guide.md');
    await go('/repositories/12/files/README.md');
    await go('/repositories/12');

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(12);

    await go('/repositories/13/files/README.md');

    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith(13);
  });

  it('shows Page not found for a missing repository', async () => {
    const answer = new Subject<RepositorySummary>();
    answers.push(answer);
    await visit('/repositories/12');

    // Nothing of the screen shows while the repository opens.
    expect(page().querySelector('ui-app-shell')).toBeNull();
    expect(page().querySelector('ui-spinner')).not.toBeNull();

    answer.error(
      new HttpErrorResponse({ status: 404, error: { code: 'not-found', params: {}, requestId: '', message: '' } })
    );
    await settle(harness.fixture);

    expect(page().querySelector('shell-page-not-found h1')?.textContent?.trim()).toBe(
      'web-shell.PageNotFoundPage.heading'
    );
    expect(page().querySelector('shell-app-header')).not.toBeNull();
    expect(page().querySelector('rs-not-openable')).toBeNull();
    expect(document.title).toBe('web-shell.PageNotFoundPage.title · Front Burner');
  });

  describe('one app shell for every state', () => {
    function expectOneShell(): void {
      expect(page().querySelectorAll('ui-app-shell').length).toBe(1);
      expect(page().querySelector('ui-activity-bar')).toBeNull();
    }

    it('renders the missing message in a centred island', async () => {
      answers.push(failure(404, 'not-found'));
      await visit('/repositories/12');

      expectOneShell();
      expect(page().querySelector('ui-app-shell ui-centred-island shell-page-not-found, ui-app-shell shell-page-not-found ui-centred-island')).not.toBeNull();
    });

    it('renders the failure in a centred island', async () => {
      answers.push(failure(500, 'internal'));
      await visit('/repositories/12');

      expectOneShell();
      expect(page().querySelector('ui-app-shell ui-centred-island ui-inline-banner')).not.toBeNull();
    });

    it('renders the not-openable message in a centred island', async () => {
      answers.push(of({ ...handbook, status: 'cloning' }));
      await visit('/repositories/12');

      expectOneShell();
      expect(page().querySelector('ui-centred-island rs-not-openable')).not.toBeNull();
    });

    it.each([
      [ 'missing', () => failure(404, 'not-found'), 'shell-app-header' ],
      [ 'failed', () => failure(500, 'internal'), 'shell-app-header' ],
      [ 'not-openable', () => of({ ...handbook, status: 'cloning' as const }), 'rs-repository-bar' ]
    ])('puts the header of %s in the shell header and leaves main unlabelled', async (_state, answer, selector) => {
      answers.push(answer());
      await visit('/repositories/12');

      expect(page().querySelector(`ui-app-shell header ${selector}`)).not.toBeNull();
      expect(page().querySelector(`ui-app-shell main ${selector}`)).toBeNull();
      expect(page().querySelector('ui-app-shell main')?.hasAttribute('aria-label')).toBe(false);
    });

    it('renders no shell while loading', async () => {
      answers.push(new Subject<RepositorySummary>());
      await visit('/repositories/12');

      expect(page().querySelector('ui-app-shell')).toBeNull();
    });
  });

  it('AC-FILE-001.3: shows the status and the settings link for a cloning repository', async () => {
    answers.push(of({ ...handbook, status: 'cloning' }));
    await visit('/repositories/12');

    const notOpenable = page().querySelector('rs-not-openable') as HTMLElement;
    expect(notOpenable.textContent).toContain('web-feature-repository-screen.NotOpenableComponent.cloning');
    expect(notOpenable.querySelector('a')?.getAttribute('href')).toBe('/repositories/12/settings');
  });

  it('opens a repository when its clone finishes', async () => {
    answers.push(of({ ...handbook, status: 'cloning' }));
    await visit('/repositories/12');

    events.next({ type: 'repository.status', repositoryId: 12, status: 'ready', error: null });
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(open).toHaveBeenCalledTimes(2);
    expect(page().querySelector('rs-not-openable')).toBeNull();
    expect(page().querySelector('rs-file-tree')).not.toBeNull();
    expect(TestBed.inject(Router).url).toBe('/repositories/12/files/README.md');
  });

  it('lists the tree afresh when the repository is ready again after an error', async () => {
    await visit('/repositories/12/files/README.md');
    folders[''] = listing('', [ entry('README.md'), entry('fresh.md') ]);

    events.next({ type: 'repository.status', repositoryId: 12, status: 'error', error: 'working-copy-missing' });
    await settle(harness.fixture);
    expect(page().querySelector('rs-not-openable')).not.toBeNull();
    events.next({ type: 'repository.status', repositoryId: 12, status: 'ready', error: null });
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(page().querySelector('rs-not-openable')).toBeNull();
    expect(page().querySelector('[role="treeitem"][aria-label^="fresh.md,"]')).not.toBeNull();
  });

  it('keeps the tree while the repository opens again', async () => {
    await visit('/repositories/12/files/README.md');
    listings = [];
    const answer = new Subject<RepositorySummary>();
    answers.push(answer);

    harness.routeDebugElement?.injector.get(RepositorySessionService).retry();
    await settle(harness.fixture);
    answer.next(handbook);
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(listings).toEqual([]);
    expect(page().querySelector('[role="treeitem"]')).not.toBeNull();
  });

  it('offers Try again when opening fails', async () => {
    answers.push(failure(500, 'internal'));
    await visit('/repositories/12');

    expect(page().textContent).toContain(`${KEY}.openFailed`);
    expect(page().textContent).toContain('Something went wrong.');
    expect(page().textContent).toContain('abcdef12');

    button(`${KEY}.retry`)?.click();
    await settle(harness.fixture);

    expect(open).toHaveBeenCalledTimes(2);
    expect(page().textContent).not.toContain(`${KEY}.openFailed`);
  });

  it('shows no other page\'s title while opening or after a failure', async () => {
    document.title = 'Dashboard · Front Burner';
    const answer = new Subject<RepositorySummary>();
    answers.push(answer);
    await visit('/repositories/12');
    expect(document.title).toBe('Front Burner');

    answer.error(new HttpErrorResponse({ status: 500 }));
    await settle(harness.fixture);
    expect(document.title).toBe('Front Burner');
  });

  it('drops the previous repository\'s title when moving to another', async () => {
    await visit('/repositories/12');
    expect(document.title).toBe('README.md · handbook · Front Burner');

    answers.push(new Subject());
    await go('/repositories/13');

    expect(document.title).toBe('Front Burner');
  });

  it('publishes its title for the route announcer, again for each file', async () => {
    const published: string[] = [];
    await visit('/repositories/12/files/README.md');
    TestBed.inject(PageTitleService).changes.subscribe(title => published.push(title));

    await go('/repositories/12/files/docs/guide.md');

    expect(published).toEqual([ 'guide.md · handbook · Front Burner' ]);
  });

  it('titles the page with the repository name without a file', async () => {
    folders[''] = listing('', [ entry('notes.md') ]);
    await visit('/repositories/12');

    expect(document.title).toBe('handbook · Front Burner');
  });

  it('titles the page with the file name', async () => {
    await visit('/repositories/12/files/docs/guide.md');

    expect(document.title).toBe('guide.md · handbook · Front Burner');
  });

  describe('when the repository has opened', () => {
    const files = () => page().querySelector('ui-activity-bar button[uiActivityBarItem="files"]') as HTMLButtonElement;
    const pressed = () => files().getAttribute('aria-pressed');
    const tree = () => page().querySelector('section.files') as HTMLElement;
    const shown = (element: Element) => !element.closest('[hidden]');

    afterEach(() => localStorage.clear());

    it('labels the regions', async () => {
      await visit('/repositories/12');

      expect(page().querySelector('header rs-repository-bar h1')?.textContent?.trim()).toBe('handbook');
      expect(tree().hasAttribute('aria-label')).toBe(false);
      expect(tree().querySelector('ui-island')?.getAttribute('aria-label')).toBe(`${KEY}.files`);
      expect(page().querySelector('ui-split-pane [role="separator"]')?.getAttribute('aria-label')).toBe(
        `${KEY}.resizeFiles`
      );
      expect(page().querySelector('main')?.getAttribute('aria-label')).toBe(`${KEY}.editor`);
      expect(page().querySelector('main rs-editor-area')).not.toBeNull();
    });

    const row = (name: string) =>
      [ ...page().querySelectorAll<HTMLElement>('[role="treeitem"]') ].find(item =>
        item.getAttribute('aria-label')?.startsWith(`${name},`)
      ) as HTMLElement;
    const url = () => TestBed.inject(Router).url;
    const editor = () => page().querySelector('main') as HTMLElement;
    const editorText = () => editor().querySelector('rs-editor-pane .cm-content')?.textContent ?? '';
    const MESSAGE = 'web-feature-repository-screen.EntryMessageComponent';

    it('AC-EDIT-001.1: opens a Markdown file selected in the tree in the editor', async () => {
      await visit('/repositories/12/files/docs/guide.md');
      expect(editorText()).toContain('# docs/guide.md');

      row('README.md').click();
      await settle(harness.fixture);
      await settle(harness.fixture);

      expect(url()).toBe('/repositories/12/files/README.md');
      expect(readFile).toHaveBeenLastCalledWith('README.md');
      expect(editorText()).toContain('# README.md');
      expect(editor().querySelector('.cm-content')?.getAttribute('aria-label')).toBe('README.md');
    });

    it('AC-EDIT-001.18: opens a file linked from the preview, with the heading', async () => {
      await visit('/repositories/12/files/docs/guide.md');
      const preview = harness.fixture.debugElement.query(element => element.name === 'md-preview');

      preview.componentInstance.openPath.emit({ path: 'README.md', fragment: 'install', newTab: false });
      await settle(harness.fixture);
      await settle(harness.fixture);

      expect(url()).toBe('/repositories/12/files/README.md#install');
      expect(editorText()).toContain('# README.md');
      expect(harness.fixture.debugElement.query(element => element.name === 'md-preview').componentInstance.fragment())
        .toBe('install');
    });

    it('opens a file linked from the preview in a new tab when asked', async () => {
      await visit('/repositories/12/files/docs/guide.md');
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      const preview = harness.fixture.debugElement.query(element => element.name === 'md-preview');

      preview.componentInstance.openPath.emit({ path: 'docs/a b.md', fragment: 'install', newTab: true });
      await settle(harness.fixture);

      expect(open).toHaveBeenCalledWith('/repositories/12/files/docs/a%20b.md#install', '_blank', 'noopener');
      expect(url()).toBe('/repositories/12/files/docs/guide.md');
      open.mockRestore();
    });

    it('AC-FILE-001.10: says why a Markdown file could not be opened', async () => {
      readFile.mockImplementation(() => failure(422, 'file-not-utf8'));

      await visit('/repositories/12/files/README.md');

      expect(editor().textContent).toContain(`${MESSAGE}.notUtf8`);
      expect(editor().querySelector('rs-editor-pane')).toBeNull();
    });

    it('opens the README the first time', async () => {
      await visit('/repositories/12');

      expect(url()).toBe('/repositories/12/files/README.md');
      expect(editorText()).toContain('# README.md');
      expect(row('README.md').getAttribute('aria-selected')).toBe('true');
      expect(localStorage.getItem('fb.4.repo.12.lastFile')).toBe('README.md');
    });

    it('opens the last file on the same device', async () => {
      localStorage.setItem('fb.4.repo.12.lastFile', 'docs/guide.md');

      await visit('/repositories/12');

      expect(url()).toBe('/repositories/12/files/docs/guide.md');
      expect(row('docs').getAttribute('aria-expanded')).toBe('true');
      expect(row('guide.md').getAttribute('aria-selected')).toBe('true');
      expect(editorText()).toContain('# docs/guide.md');
    });

    it('falls back to the README when the last file is gone', async () => {
      localStorage.setItem('fb.4.repo.12.lastFile', 'docs/gone.md');

      await visit('/repositories/12');

      expect(url()).toBe('/repositories/12/files/README.md');
      expect(editor().textContent).not.toContain(`${MESSAGE}.missing`);
    });

    it('shows the empty state without a README', async () => {
      folders[''] = listing('', [ entry('notes.md'), entry('README.txt') ]);

      await visit('/repositories/12');

      expect(url()).toBe('/repositories/12');
      expect(page().querySelector('main ui-empty-state')?.textContent).toContain(
        'web-feature-repository-screen.EditorAreaComponent.empty'
      );
    });

    it('says the open file was deleted elsewhere, until another file is opened (FB-42)', async () => {
      await visit('/repositories/12/files/docs/guide.md');
      const GONE = 'web-feature-repository-screen.EditorAreaComponent.goneElsewhere';

      folders['docs'] = listing('docs', [ entry('other.md') ]);
      gone.add('docs/guide.md');
      events.next({ type: 'files.changed', repositoryId: 12, folders: [ 'docs' ] });
      await settle(harness.fixture);
      await settle(harness.fixture);

      expect(url()).toBe('/repositories/12/files/docs/guide.md');
      expect(editor().textContent).toContain(GONE);
      expect(row('other.md')).toBeDefined();

      await go('/repositories/12/files/docs/other.md');

      expect(editor().textContent).not.toContain(GONE);
    });

    it('shows the empty state, not the README, when the open file was closed (FB-39)', async () => {
      await visit('/repositories/12/files/logo.png');

      await TestBed.inject(Router).navigate([ '/repositories', 12 ], { replaceUrl: true, state: { closed: true } });
      await settle(harness.fixture);
      await settle(harness.fixture);

      expect(url()).toBe('/repositories/12');
      expect(page().querySelector('main ui-empty-state')?.textContent).toContain(
        'web-feature-repository-screen.EditorAreaComponent.empty'
      );

      // Any other way to the screen without a file opens the README (FB-12).
      await go('/repositories/12/files/logo.png');
      await go('/repositories/12');

      expect(url()).toBe('/repositories/12/files/README.md');
    });

    it('creates a file from the empty state and opens it', async () => {
      folders[''] = listing('', [ entry('notes.txt') ]);
      await visit('/repositories/12');

      (page().querySelector('main [uiEmptyStateActions] button') as HTMLButtonElement).click();
      await settle(harness.fixture);
      const input = document.querySelector('.cdk-overlay-container rs-entry-name input') as HTMLInputElement;
      input.value = 'notes';
      input.dispatchEvent(new Event('input'));
      folders[''] = listing('', [ entry('notes.md'), entry('notes.txt') ]);
      (document.querySelector('.cdk-overlay-container button[type="submit"]') as HTMLButtonElement).click();
      await settle(harness.fixture);
      await settle(harness.fixture);

      expect(createEntry).toHaveBeenCalledWith(12, { folder: '', name: 'notes', kind: 'file' });
      expect(url()).toBe('/repositories/12/files/notes.md');
    });

    it('shows a missing path\'s message', async () => {
      await visit('/repositories/12/files/nope/x.md');

      expect(editor().querySelector('h2')?.textContent?.trim()).toBe('x.md');
      expect(editor().textContent).toContain(`${MESSAGE}.missing`);
      // The tree is shown as usual (FB-13).
      expect(row('README.md')).toBeDefined();
      expect(page().querySelector('ui-spinner')).toBeNull();
    });

    it.each([
      [ 'logo.png', 'nonMarkdown' ],
      [ 'latest', 'symlink' ],
      [ 'vendor', 'submodule' ]
    ])('AC-FILE-001.9: shows %s\'s message', async (name, key) => {
      await visit(`/repositories/12/files/${name}`);

      expect(editor().querySelector('h2')?.textContent?.trim()).toBe(name);
      expect(editor().textContent).toContain(`${MESSAGE}.${key}`);
      expect(editor().querySelector('rs-editor-pane')).toBeNull();
      expect(row(name).getAttribute('aria-selected')).toBe('true');
      // Only Markdown files are remembered as the last file.
      expect(localStorage.getItem('fb.4.repo.12.lastFile')).toBeNull();
    });

    const tryAgain = () =>
      page().querySelector<HTMLElement>(
        '[role="treeitem"][aria-label^="web-feature-repository-screen.FileTreeStoreService.loadFailed"]'
      ) as HTMLElement;

    it('shows the file once its folder loads on Try again', async () => {
      failOnce.add('docs');
      await visit('/repositories/12/files/docs/guide.md');

      // Not "doesn't exist": the folder could not be listed.
      expect(editor().textContent).not.toContain(`${MESSAGE}.missing`);
      expect(editor().querySelector('h2')).toBeNull();

      tryAgain().click();
      await settle(harness.fixture);
      await settle(harness.fixture);

      expect(editorText()).toContain('# docs/guide.md');
      expect(row('guide.md').getAttribute('aria-selected')).toBe('true');
    });

    it('opens the first file once the root loads on Try again', async () => {
      localStorage.setItem('fb.4.repo.12.lastFile', 'docs/guide.md');
      failOnce.add('');
      await visit('/repositories/12');

      expect(url()).toBe('/repositories/12');
      expect(page().querySelector('main ui-empty-state')).toBeNull();

      tryAgain().click();
      await settle(harness.fixture);
      await settle(harness.fixture);

      expect(url()).toBe('/repositories/12/files/docs/guide.md');
    });

    it('closes the drawer when the open file is selected again', async () => {
      narrow = true;
      await visit('/repositories/12/files/README.md');
      files().click();
      await settle(harness.fixture);

      row('README.md').click();
      await settle(harness.fixture);

      expect(shown(tree())).toBe(false);
      expect(url()).toBe('/repositories/12/files/README.md');
    });

    it('opens the selected file', async () => {
      await visit('/repositories/12');

      row('docs').click();
      await settle(harness.fixture);
      row('guide.md').click();
      await settle(harness.fixture);
      await settle(harness.fixture);

      expect(url()).toBe('/repositories/12/files/docs/guide.md');
      expect(editorText()).toContain('# docs/guide.md');
    });

    it('closes the drawer when a file is selected', async () => {
      narrow = true;
      await visit('/repositories/12');
      files().click();
      await settle(harness.fixture);
      expect(shown(tree())).toBe(true);

      row('docs').click();
      await settle(harness.fixture);
      // A folder only expands.
      expect(shown(tree())).toBe(true);

      row('guide.md').click();
      await settle(harness.fixture);
      await settle(harness.fixture);

      expect(url()).toBe('/repositories/12/files/docs/guide.md');
      expect(shown(tree())).toBe(false);
    });

    it('puts the file tree and the editor in two islands', async () => {
      await visit('/repositories/12');

      const [ side, editor ] = [ 'section.files > ui-island', 'main > ui-island' ].map(selector =>
        page().querySelector(selector)
      );
      expect(side?.getAttribute('aria-label')).toBe(`${KEY}.files`);
      expect(side?.querySelector('rs-file-tree')).not.toBeNull();
      expect(editor?.querySelector('rs-editor-area')).not.toBeNull();
      expect(side).not.toBe(editor);
    });

    it('has one pressed Files item with a folder icon in the activity bar', async () => {
      await visit('/repositories/12');

      const bar = page().querySelector('ui-activity-bar') as HTMLElement;
      expect(bar.getAttribute('aria-label')).toBe(`${KEY}.toolWindows`);
      expect(bar.querySelectorAll('button')).toHaveLength(1);
      expect(files().getAttribute('aria-label')).toBe(`${KEY}.files`);
      expect(files().querySelector('ui-icon[name="folder"]')).not.toBeNull();
      expect(pressed()).toBe('true');
      expect(button('web-feature-repository-screen.RepositoryBarComponent.files')).toBeUndefined();
    });

    it('lays the activity bar out vertically on wide screens and horizontally on narrow ones', async () => {
      await visit('/repositories/12');
      expect(page().querySelector('ui-activity-bar')?.getAttribute('aria-orientation')).toBe('vertical');

      viewport.next(true);
      await settle(harness.fixture);
      expect(page().querySelector('ui-activity-bar')?.getAttribute('aria-orientation')).toBe('horizontal');
    });

    it('shows the item unpressed when the tree was left collapsed', async () => {
      localStorage.setItem('fb.4.repositoryScreen.sideOpen', 'false');
      await visit('/repositories/12');

      expect(shown(tree())).toBe(false);
      expect(pressed()).toBe('false');
    });

    it('unpresses the item when a file is opened from the drawer', async () => {
      narrow = true;
      await visit('/repositories/12');
      files().click();
      await settle(harness.fixture);
      expect(pressed()).toBe('true');

      row('README.md').click();
      await settle(harness.fixture);
      await settle(harness.fixture);

      expect(shown(tree())).toBe(false);
      expect(pressed()).toBe('false');
    });

    it('leaves the item consistent when the viewport crosses the breakpoint with the drawer open', async () => {
      narrow = true;
      await visit('/repositories/12');
      files().click();
      await settle(harness.fixture);
      expect(pressed()).toBe('true');

      viewport.next(false);
      await settle(harness.fixture);

      // The drawer closed with the crossing; the wide tree was never collapsed.
      expect(pressed()).toBe('true');
      expect(shown(tree())).toBe(true);

      viewport.next(true);
      await settle(harness.fixture);
      expect(shown(tree())).toBe(false);
      expect(pressed()).toBe('false');
    });

    it('collapses and expands the tree with Files, and remembers it', async () => {
      await visit('/repositories/12');
      expect(shown(tree())).toBe(true);
      expect(pressed()).toBe('true');

      files().click();
      await settle(harness.fixture);

      expect(shown(tree())).toBe(false);
      expect(pressed()).toBe('false');
      expect(localStorage.getItem('fb.4.repositoryScreen.sideOpen')).toBe('false');

      files().click();
      await settle(harness.fixture);
      expect(shown(tree())).toBe(true);
    });

    it('remembers the size of the tree', async () => {
      await visit('/repositories/12');
      const separator = page().querySelector('ui-split-pane [role="separator"]') as HTMLElement;

      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await settle(harness.fixture);

      expect(separator.getAttribute('aria-valuenow')).toBe('25');
      expect(localStorage.getItem('fb.4.repositoryScreen.sideSize')).toBe('25');
    });

    it('opens the tree as a drawer with Files on narrow screens', async () => {
      narrow = true;
      await visit('/repositories/12');
      expect(shown(tree())).toBe(false);
      expect(shown(page().querySelector('main') as HTMLElement)).toBe(true);
      expect(pressed()).toBe('false');

      files().click();
      await settle(harness.fixture);

      expect(shown(tree())).toBe(true);
      expect(pressed()).toBe('true');
      // The drawer does not collapse the tree of wide screens.
      expect(localStorage.getItem('fb.4.repositoryScreen.sideOpen')).toBe('true');
    });

    it('shows the bar without Files for a repository that cannot be opened', async () => {
      answers.push(of({ ...handbook, status: 'cloning' }));
      await visit('/repositories/12');

      expect(page().querySelector('header rs-repository-bar h1')?.textContent?.trim()).toBe('handbook');
      expect(files()).toBeNull();
      expect(page().querySelector('ui-activity-bar')).toBeNull();
      expect(page().querySelector('section.files')).toBeNull();
    });
  });
  describe('editing and saving', () => {
    const STATUS = 'web-feature-repository-screen.SaveStatusComponent';
    const status = () => page().querySelector('rs-repository-bar rs-save-status')?.textContent?.trim();

    /** Types `text` at the end of the open file, as a keystroke in the editor would. */
    function typeAtEnd(text: string): void {
      const editor = harness.fixture.debugElement.query(element => element.name === 'ce-code-editor');
      const code = editor.componentInstance as {
        state(): EditorStateChange['state'];
        stateChange: { emit(change: EditorStateChange): void; };
      };
      const state = code.state();
      code.stateChange.emit({
        state: state.update({ changes: { from: state.doc.length, insert: text } }).state,
        docChanged: true
      });
      harness.fixture.detectChanges();
    }

    const savedPaths = () => saveFile.mock.calls.map(call => (call[1] as { path: string; }).path);

    it('shows the open file\'s save status in the bar', async () => {
      saveFile.mockReturnValue(new Subject());
      await visit('/repositories/12/files/README.md');
      expect(status()).toBe(`${STATUS}.saved`);

      typeAtEnd('More.\n');
      await settle(harness.fixture);

      expect(status()).toBe(`${STATUS}.saving`);
    });

    it('AC-EDIT-001.4: saves the first file when another is opened', async () => {
      await visit('/repositories/12/files/README.md');
      typeAtEnd('More.\n');

      await go('/repositories/12/files/docs/guide.md');

      expect(savedPaths()).toEqual([ 'README.md' ]);
      expect(saveFile.mock.calls[0][1]).toMatchObject({ content: '# README.md\nMore.\n' });
    });

    it('AC-EDIT-001.4: saves the first file also when the other one fails to open', async () => {
      readFile.mockImplementation(path =>
        path === 'README.md' ? of(fileContent(path)) : failure(422, 'file-too-large')
      );
      await visit('/repositories/12/files/README.md');
      typeAtEnd('More.\n');

      await go('/repositories/12/files/docs/guide.md');

      expect(savedPaths()).toEqual([ 'README.md' ]);
    });

    it('AC-APP-001.6: saves an edit typed just before switching repositories', async () => {
      await visit('/repositories/12/files/README.md');
      typeAtEnd('More.\n');

      await go('/repositories/13');

      expect(saveFile).toHaveBeenCalledTimes(1);
      expect(saveFile.mock.calls[0][0]).toBe(12);
    });

    it('flushes when the tab is hidden', async () => {
      await visit('/repositories/12/files/README.md');
      typeAtEnd('More.\n');
      expect(saveFile).not.toHaveBeenCalled();

      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      try {
        document.dispatchEvent(new Event('visibilitychange'));
        await settle(harness.fixture);
      } finally {
        Reflect.deleteProperty(document, 'visibilityState');
      }

      expect(savedPaths()).toEqual([ 'README.md' ]);
      expect(status()).toBe(`${STATUS}.saved`);
    });

    it('flushes when the screen is left', async () => {
      await visit('/repositories/12/files/README.md');
      typeAtEnd('More.\n');

      harness.fixture.destroy();
      await new Promise(resolve => setTimeout(resolve));

      expect(savedPaths()).toEqual([ 'README.md' ]);
    });

    it('asks before the tab closes with unsaved edits', async () => {
      saveFile.mockReturnValue(new Subject());
      const listens = vi.spyOn(window, 'addEventListener');
      await visit('/repositories/12/files/README.md');
      // Not listening otherwise keeps the page in the back/forward cache.
      expect(listens.mock.calls.map(([ type ]) => type)).not.toContain('beforeunload');
      const unload = () => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      };
      expect(unload()).toBe(false);

      typeAtEnd('More.\n');

      expect(unload()).toBe(true);
    });

    it('writes the waiting content as a draft when the page is hidden for good', async () => {
      await visit('/repositories/12/files/README.md');
      typeAtEnd('More.\n');

      window.dispatchEvent(new Event('pagehide'));
      await settle(harness.fixture);

      expect(drafts.at('README.md', 12, ada.id)?.content).toBe('# README.md\nMore.\n');
    });

    it('offers a draft when a file is opened, with the editor read-only until the user chooses', async () => {
      await drafts.put({ userId: ada.id, repositoryId: 12, path: 'README.md' }, {
        content: '# README.md\nOffline.\n',
        savedAt: '2026-10-29T10:05:00.000Z'
      });

      await visit('/repositories/12/files/README.md');

      expect(page().querySelector('rs-draft-offer')).not.toBeNull();
      expect(page().querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false');
      button('web-feature-repository-screen.DraftOfferComponent.restore')?.click();
      await settle(harness.fixture);

      expect(page().querySelector('rs-draft-offer')).toBeNull();
      expect(saveFile.mock.calls[0][1]).toMatchObject({ path: 'README.md', content: '# README.md\nOffline.\n' });
    });

    it('does not announce the title again when only the dot changes', async () => {
      saveFile.mockReturnValue(new Subject());
      await visit('/repositories/12/files/README.md');
      const published: string[] = [];
      const subscription = TestBed.inject(PageTitleService).changes.subscribe(title => published.push(title));

      typeAtEnd('More.\n');
      await settle(harness.fixture);
      subscription.unsubscribe();

      expect(document.title).toBe('• README.md · handbook · Front Burner');
      expect(published).toEqual([]);
    });

    it('AC-APP-001.9: puts a dot in the title while an edit is unsaved', async () => {
      const answer = new Subject<{ hash: string; size: number; }>();
      saveFile.mockReturnValue(answer);
      await visit('/repositories/12/files/README.md');
      expect(document.title).toBe('README.md · handbook · Front Burner');

      typeAtEnd('More.\n');
      await settle(harness.fixture);
      expect(document.title).toBe('• README.md · handbook · Front Burner');

      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Reflect.deleteProperty(document, 'visibilityState');
      answer.next({ hash: 'b'.repeat(64), size: 20 });
      answer.complete();
      await settle(harness.fixture);

      expect(document.title).toBe('README.md · handbook · Front Burner');
    });

    describe('changes on disk (ED-21, ED-24)', () => {
      const THEIRS = 'c'.repeat(64);
      const editorText = () => page().querySelector('rs-editor-pane .cm-content')?.textContent ?? '';
      const toasts = () => TestBed.inject(ToastService).toasts().map(toast => toast.message);
      const button = (text: string) =>
        [ ...page().querySelectorAll<HTMLButtonElement>('rs-editor-pane button') ].find(element =>
          element.textContent?.trim() === text
        );

      function changedElsewhere(): void {
        readFile.mockImplementation(path => of(fileContent(path, { content: 'Theirs.\n', hash: THEIRS })));
        events.next({
          type: 'files.changed',
          repositoryId: 12,
          folders: [ '' ],
          files: [ { path: 'README.md', hash: THEIRS } ]
        });
      }

      it('AC-EDIT-001.12: updates the editor after a change elsewhere and says so', async () => {
        await visit('/repositories/12/files/README.md');

        changedElsewhere();
        await settle(harness.fixture);
        await settle(harness.fixture);

        expect(editorText()).toContain('Theirs.');
        expect(toasts()).toEqual([ 'web-feature-repository-screen.DiskChangesService.updated' ]);
      });

      it('AC-EDIT-001.12: asks with unsaved edits, and Reload loads the change', async () => {
        saveFile.mockReturnValue(new Subject());
        await visit('/repositories/12/files/README.md');
        typeAtEnd('Mine.\n');

        changedElsewhere();
        await settle(harness.fixture);
        await settle(harness.fixture);

        expect(editorText()).toContain('Mine.');
        expect(status()).toBe(`${STATUS}.notSaved`);
        expect(toasts()).toEqual([]);
        button('web-feature-repository-screen.ChangedOnDiskComponent.reload')?.click();
        await settle(harness.fixture);
        await settle(harness.fixture);

        expect(editorText()).toContain('Theirs.');
        expect(editorText()).not.toContain('Mine.');
        expect(status()).toBe(`${STATUS}.saved`);
        expect(page().querySelector('rs-changed-on-disk')).toBeNull();
        expect(saveFile).not.toHaveBeenCalled();
      });

      it('AC-FILE-001.21: keeps unsaved edits of a file deleted elsewhere and offers Recreate it', async () => {
        saveFile.mockReturnValue(new Subject());
        await visit('/repositories/12/files/README.md');
        typeAtEnd('Mine.\n');

        gone.add('README.md');
        folders[''] = listing('', [ folder('docs') ]);
        events.next({ type: 'files.changed', repositoryId: 12, folders: [ '' ] });
        await settle(harness.fixture);
        await settle(harness.fixture);

        expect(editorText()).toContain('Mine.');
        expect(page().querySelector('rs-editor-area')?.textContent).not.toContain(
          'web-feature-repository-screen.EditorAreaComponent.goneElsewhere'
        );
        expect(page().querySelector('rs-gone-elsewhere')).not.toBeNull();
        expect(status()).toBe(`${STATUS}.notSaved`);

        button('web-feature-repository-screen.GoneElsewhereComponent.recreate')?.click();
        await settle(harness.fixture);

        expect(recreateFile).toHaveBeenCalledWith(
          12,
          expect.objectContaining({
            path: 'README.md',
            content: '# README.md\nMine.\n'
          })
        );
        expect(page().querySelector('rs-gone-elsewhere')).toBeNull();
        expect(status()).toBe(`${STATUS}.saved`);
      });

      it('checks a file opened again for changes made while another was open', async () => {
        await visit('/repositories/12/files/README.md');
        await go('/repositories/12/files/docs/guide.md');
        readFile.mockImplementation(path => of(fileContent(path, { content: 'Theirs.\n', hash: THEIRS })));
        gone.clear();

        await go('/repositories/12/files/README.md');
        await settle(harness.fixture);

        expect(editorText()).toContain('Theirs.');
      });
    });
  });
});
