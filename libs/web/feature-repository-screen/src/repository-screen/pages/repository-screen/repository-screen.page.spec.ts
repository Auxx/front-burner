import { BreakpointObserver } from '@angular/cdk/layout';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type {
  CurrentUser,
  FileContent,
  FolderListing,
  GitBranchList,
  GitChange,
  GitConflictFile,
  GitDiff,
  GitJobStarted,
  GitJobState,
  GitMergeState,
  GitStatus,
  PushEvent,
  RepositoryCredentialsInfo,
  RepositorySummary
} from '@front-burner/shared-contracts';
import { DialogService, ToastService } from '@front-burner/ui';
import { CredentialsApi, FilesApi, GitApi, RepositoriesApi } from '@front-burner/web-api-client';
import type { EditorStateChange } from '@front-burner/web-code-editor';
import { AuthSessionService, CurrentUserService, PageTitleService, PushChannelService } from '@front-burner/web-core';
import { BehaviorSubject, map, Observable, of, Subject, take, throwError } from 'rxjs';

import { dialogButton, overlay, settleDialog } from '../../../testing/dialog-testing';
import { MemoryDraftStore, provideMemoryDrafts } from '../../../testing/drafts';
import { entry, folder, listing } from '../../../testing/listings';
import { fileContent } from '../../../testing/open-files';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { restoreLayout, stubViewportLayout } from '../../../testing/viewport-layout';
import { routes } from '../../repository-screen.routes';
import { FileTreeStoreService } from '../../services/file-tree-store/file-tree-store.service';
import { GitStatusStore } from '../../services/git-status-store/git-status-store.service';
import { RepositorySessionService } from '../../services/repository-session/repository-session.service';

import { RepositoryScreenPage } from './repository-screen.page';

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
  let gitDiff: ReturnType<typeof vi.fn<(path: string) => Observable<GitDiff>>>;
  let push: ReturnType<typeof vi.fn<(id: number) => Observable<GitJobStarted>>>;
  let fetch: ReturnType<typeof vi.fn<(id: number) => Observable<GitJobStarted>>>;
  let pull: ReturnType<typeof vi.fn<(id: number) => Observable<GitJobStarted>>>;
  let gitJob: ReturnType<typeof vi.fn<(id: number, jobId: number) => Observable<GitJobState>>>;
  let fetchOnFileOpened: ReturnType<typeof vi.fn<(id: number) => Observable<void>>>;
  let recreateFile: ReturnType<typeof vi.fn>;
  /** What `RepositoriesApi.repositoryCredentials` answers. */
  let credentialsInfo: RepositoryCredentialsInfo;
  let unlockSshKey: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;
  let narrow: boolean;
  /** The viewport's narrowness, which a test can flip. */
  let viewport: BehaviorSubject<boolean>;
  let events: Subject<PushEvent>;
  /** What `PushChannelService.view` was told. */
  let view: ReturnType<typeof vi.fn<(repositoryId: number | null) => void>>;
  /** The folders listed, in order. */
  let listings: string[];
  let drafts: MemoryDraftStore;
  /** The files `fileState` does not find. */
  let gone: Set<string>;
  /** The paths of each `GitApi.discard`. */
  let discards: string[][];
  let discardAnswer: (paths: string[]) => Observable<void>;
  /** What `GitApi.gitStatus` answers. */
  let changes: GitChange[];
  /** In place of `changes`, such as a failure. */
  let gitStatusAnswer: Observable<GitStatus> | undefined;
  let abortMerge: ReturnType<typeof vi.fn>;
  /** What `GitApi.gitMerge` answers. */
  let mergeAnswer: GitMergeState;
  let gitBranches: ReturnType<typeof vi.fn<(id: number) => Observable<GitBranchList>>>;
  let switchBranch: ReturnType<typeof vi.fn<() => Observable<void>>>;

  const baseStatus = (): GitStatus => ({
    branch: 'main',
    noCommits: false,
    lastCommit: null,
    upstream: null,
    upstreamGone: false,
    sameNameRemote: false,
    ahead: 0,
    behind: 0,
    changes,
    mergeInProgress: false,
    networkJob: null,
    undoableMerge: false,
    fetchProblem: null
  });
  const page = () => harness.fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [ ...page().querySelectorAll('button') ].find(element => element.textContent?.trim() === text);

  async function visit(url: string): Promise<void> {
    viewport = new BehaviorSubject(narrow);
    TestBed.configureTestingModule({
      imports: [ translocoTesting({ 'errors.internal': 'Something went wrong.' }) ],
      providers: [
        provideRouter([ { path: 'repositories/:id', children: routes } ]),
        {
          provide: RepositoriesApi,
          useValue: { open, repositoryCredentials: () => of(credentialsInfo) }
        },
        { provide: CredentialsApi, useValue: { unlockSshKey } },
        {
          provide: GitApi,
          useValue: {
            diff: (_id: number, query: { path: string; }) => gitDiff(query.path),
            push,
            fetch,
            pull,
            incoming: () => of({ incoming: { upstream: 'origin/main', commits: 3, touchesPath: false } }),
            gitJob,
            fetchOnFileOpened,
            discard: (_id: number, body: { paths: string[]; }) => {
              discards.push(body.paths);
              return discardAnswer(body.paths);
            },
            gitStatus: (): Observable<GitStatus> => gitStatusAnswer ?? of(baseStatus()),
            gitBranches,
            switchBranch,
            gitMerge: () => of(mergeAnswer),
            abortMerge
          }
        },
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
        { provide: PushChannelService, useValue: { events, reconnected: new Subject<void>(), view } },
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
    view = vi.fn();
    listings = [];
    localStorage.clear();
    open = vi.fn((id: number) => answers.shift() ?? of({ ...handbook, id }));
    createEntry = vi.fn((_id: number, request: { name: string; }) => of({ path: `${request.name}.md` }));
    readFile = vi.fn((path: string) => of(fileContent(path)));
    gone = new Set();
    changes = [];
    gitStatusAnswer = undefined;
    abortMerge = vi.fn(() => of(undefined));
    mergeAnswer = { into: 'main', from: 'origin/main', files: [], otherFiles: [], message: 'Merge' };
    switchBranch = vi.fn(() => of(undefined));
    gitBranches = vi.fn(() =>
      of<GitBranchList>({
        current: 'main',
        local: [ { name: 'main', upstream: null } ],
        remote: [],
        singleBranch: false
      })
    );
    discards = [];
    discardAnswer = () => of(undefined);
    gitDiff = vi.fn(() => of<GitDiff>({ kind: 'text', lines: [], complete: true, lineEndingsOnly: false }));
    saveFile = vi.fn(() => of({ hash: 'b'.repeat(64), size: 10 }));
    push = vi.fn(() => of({ jobId: 7 }));
    fetch = vi.fn(() => of({ jobId: 8 }));
    pull = vi.fn(() => of({ jobId: 9 }));
    gitJob = vi.fn(() => of<GitJobState>({ status: 'running', outcome: null }));
    fetchOnFileOpened = vi.fn(() => of(undefined));
    recreateFile = vi.fn(() => of({ hash: 'd'.repeat(64), size: 10 }));
    credentialsInfo = { protocol: 'https', inUse: null };
    unlockSshKey = vi.fn(() => of(undefined));
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

  it('views the open repository', async () => {
    await visit('/repositories/12');
    expect(view).toHaveBeenLastCalledWith(12);

    await go('/repositories/13/files/README.md');
    expect(view).toHaveBeenLastCalledWith(13);
  });

  it('views the repository before the services start', async () => {
    const order: string[] = [];
    view.mockImplementation(() => void order.push('view'));
    open.mockImplementation((id: number) => {
      order.push('open');
      return of({ ...handbook, id });
    });
    await visit('/repositories/12');

    expect(order.slice(0, 2)).toEqual([ 'view', 'open' ]);
  });

  it('stops viewing when the page goes', async () => {
    await visit('/repositories/12');

    harness.fixture.destroy();

    expect(view).toHaveBeenLastCalledWith(null);
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
      expect(
        page().querySelector(
          'ui-app-shell ui-centred-island shell-page-not-found, ui-app-shell shell-page-not-found ui-centred-island'
        )
      ).not.toBeNull();
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
    const tree = () => page().querySelector('ui-island[uiAppShellSide]') as HTMLElement;
    const shown = (element: Element) => !element.closest('[hidden]');

    afterEach(() => localStorage.clear());

    it('labels the regions', async () => {
      await visit('/repositories/12');

      expect(page().querySelector('header rs-repository-bar h1')?.textContent?.trim()).toBe('handbook');
      expect(tree().getAttribute('aria-label')).toBe(`${KEY}.files`);
      expect(tree().getAttribute('role')).toBe('region');
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

    it('asks for a fetch when a file is opened', async () => {
      await visit('/repositories/12');
      expect(fetchOnFileOpened).toHaveBeenCalledTimes(1);
      expect(fetchOnFileOpened).toHaveBeenLastCalledWith(12);

      await go('/repositories/12/files/docs/guide.md');
      await go('/repositories/12/files/logo.png');
      // The backend decides how often it fetches (GA-33).
      await go('/repositories/12/files/README.md');
      expect(fetchOnFileOpened).toHaveBeenCalledTimes(4);

      // Not for a folder, or without a file.
      await go('/repositories/12/files/docs');
      await TestBed.inject(Router).navigate([ '/repositories', 12 ], { replaceUrl: true, state: { closed: true } });
      await settle(harness.fixture);
      expect(fetchOnFileOpened).toHaveBeenCalledTimes(4);
    });

    it('ignores a failure to ask', async () => {
      fetchOnFileOpened.mockImplementation(() => failure(500, 'internal'));

      await visit('/repositories/12/files/README.md');

      expect(fetchOnFileOpened).toHaveBeenCalledWith(12);
      expect(editorText()).toContain('# README.md');
      expect(page().querySelector('rs-git-problem')).toBeNull();
      expect(page().textContent).not.toContain('Something went wrong.');
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

      const [ side, editor ] = [ 'ui-island[uiAppShellSide]', 'main > ui-island' ].map(selector =>
        page().querySelector(selector)
      );
      expect(side?.getAttribute('aria-label')).toBe(`${KEY}.files`);
      expect(side?.querySelector('rs-file-tree')).not.toBeNull();
      expect(editor?.querySelector('rs-editor-area')).not.toBeNull();
      expect(side).not.toBe(editor);
    });

    describe('Changes', () => {
      const changesItem = () =>
        page().querySelector('ui-activity-bar button[uiActivityBarItem="changes"]') as HTMLButtonElement;
      /** Which tool window is shown; the other one stays in place, hidden. */
      const shownOnly = () => {
        const treeHidden = (page().querySelector('rs-file-tree') as HTMLElement).hidden;
        const paneHidden = (page().querySelector('rs-changes-pane') as HTMLElement).hidden;
        expect(treeHidden).not.toBe(paneHidden);
        return treeHidden ? 'changes' : 'files';
      };
      const THREE: GitChange[] = [
        { path: 'README.md', state: 'modified' },
        { path: 'docs/guide.md', state: 'modified' },
        { path: 'logo.png', state: 'deleted' }
      ];

      it('AC-GIT-002.2: lists two modified files and one deleted file, and says Changes (3)', async () => {
        changes = THREE;
        localStorage.setItem('fb.4.sideTool', 'changes');
        await visit('/repositories/12');

        expect(changesItem().getAttribute('aria-label')).toBe(`${KEY}.changesCount`);
        expect(changesItem().querySelector('.change-count')?.getAttribute('data-count')).toBe('3');
        expect([ ...page().querySelectorAll('rs-change-entry .word') ].map(word => word.textContent)).toEqual([
          'web-feature-repository-screen.ChangeEntryComponent.modified',
          'web-feature-repository-screen.ChangeEntryComponent.modified',
          'web-feature-repository-screen.ChangeEntryComponent.deleted'
        ]);
      });

      describe('selecting a change', () => {
        const entryButton = (name: string) =>
          [ ...page().querySelectorAll('rs-change-entry') ].find(row =>
            row.querySelector('.name')?.textContent?.trim() === name
          )
            ?.querySelector('button') as HTMLButtonElement;
        const diffView = () => page().querySelector('rs-diff-view');
        const editorArea = () => page().querySelector('rs-editor-area') as HTMLElement;

        async function select(name: string): Promise<void> {
          entryButton(name).click();
          await settle(harness.fixture);
        }

        beforeEach(() => {
          changes = THREE;
          localStorage.setItem('fb.4.sideTool', 'changes');
        });

        describe('discarding', () => {
          const K = 'web-feature-repository-screen.DiscardChangesDialog';

          async function discard(name: string): Promise<void> {
            entryButton(name).closest('rs-change-entry')?.querySelector<HTMLButtonElement>('.discard')?.click();
            await settleDialog();
            dialogButton(`${K}.discard`)?.click();
            await settleDialog();
            await settle(harness.fixture);
          }

          it('closes the diff of a discarded file', async () => {
            await visit('/repositories/12/files/README.md');
            await select('guide.md');
            expect(diffView()).not.toBeNull();

            await discard('guide.md');

            expect(discards).toEqual([ [ 'docs/guide.md' ] ]);
            expect(diffView()).toBeNull();
            expect(editorArea().hidden).toBe(false);
          });

          it('keeps the diff of another file', async () => {
            await visit('/repositories/12/files/README.md');
            await select('guide.md');

            await discard('README.md');

            expect(diffView()).not.toBeNull();
          });

          it('shows a file again when it comes back, as it could not be opened', async () => {
            changes = [ { path: 'docs/guide.md', state: 'deleted' } ];
            const docs = folders['docs'];
            folders['docs'] = listing('docs', []);
            await visit('/repositories/12/files/docs/guide.md');
            expect(page().querySelector('rs-editor-pane')).toBeNull();
            folders['docs'] = docs;

            await discard('guide.md');

            expect(page().querySelector('rs-editor-pane')).not.toBeNull();
          });

          it('shows a file again when its folder comes back with it', async () => {
            changes = [ { path: 'docs/guide.md', state: 'deleted' } ];
            const { '': root, docs } = folders;
            folders[''] = listing('', [ entry('README.md') ]);
            delete folders['docs'];
            await visit('/repositories/12/files/docs/guide.md');
            expect(page().querySelector('rs-editor-pane')).toBeNull();
            folders[''] = root;
            folders['docs'] = docs;

            await discard('guide.md');

            expect(page().querySelector('rs-editor-pane')).not.toBeNull();
          });

          it('shows a file again when its entry was kept but it no longer showed', async () => {
            await visit('/repositories/12/files/docs/guide.md');
            const injector = harness.routeDebugElement?.injector;
            await harness.navigateByUrl('/repositories/12/files/README.md');
            await settle(harness.fixture);
            const docs = folders['docs'];
            folders['docs'] = listing('docs', []);
            await injector?.get(FileTreeStoreService).load('docs');
            await harness.navigateByUrl('/repositories/12/files/docs/guide.md');
            await settle(harness.fixture);
            expect(page().querySelector('rs-editor-pane')).toBeNull();
            folders['docs'] = docs;
            changes = [ { path: 'docs/guide.md', state: 'deleted' } ];
            await injector?.get(GitStatusStore).refresh();
            await settle(harness.fixture);

            await discard('guide.md');

            expect(page().querySelector('rs-editor-pane')).not.toBeNull();
          });

          it('keeps the diff when the discard is cancelled', async () => {
            await visit('/repositories/12/files/README.md');
            await select('guide.md');

            entryButton('guide.md').closest('rs-change-entry')?.querySelector<HTMLButtonElement>('.discard')?.click();
            await settleDialog();
            dialogButton(`${K}.cancel`)?.click();
            await settleDialog();
            await settle(harness.fixture);

            expect(diffView()).not.toBeNull();
          });

          it('ends the diff of a file discarded by an earlier request, when a later one failed and was cancelled', async () => {
            const many = Array.from({ length: 10_001 }, (_, index) => ({
              path: `f${String(index).padStart(5, '0')}.md`,
              state: 'modified' as const
            }));
            changes = many;
            let answers = 0;
            discardAnswer = () => {
              if (++answers === 2) {
                return throwError(() => new HttpErrorResponse({ status: 503 }));
              }
              changes = many.slice(10_000);
              return of(undefined);
            };
            await visit('/repositories/12/files/README.md');
            await select('f00000.md');
            expect(diffView()).not.toBeNull();

            page().querySelector<HTMLButtonElement>('.discard-all')?.click();
            await settleDialog();
            dialogButton(`${K}.discard`)?.click();
            await settleDialog();
            dialogButton(`${K}.cancel`)?.click();
            await settleDialog();
            await settle(harness.fixture);

            expect(discards).toHaveLength(2);
            expect(diffView()).toBeNull();
          });
        });

        it('shows its diff in place of the open file, and the URL keeps naming the file', async () => {
          await visit('/repositories/12/files/README.md');

          await select('guide.md');

          expect(diffView()).not.toBeNull();
          expect(gitDiff).toHaveBeenCalledWith('docs/guide.md');
          expect(editorArea().hidden).toBe(true);
          expect(url()).toBe('/repositories/12/files/README.md');
          expect(entryButton('guide.md').getAttribute('aria-current')).toBe('true');
          expect(entryButton('README.md').getAttribute('aria-current')).toBeNull();
        });

        it('passes on the state from the status', async () => {
          await visit('/repositories/12/files/README.md');

          await select('logo.png');

          expect(page().querySelector('rs-diff-view button')).toBeNull();
        });

        it('ends when another file opens through the route', async () => {
          await visit('/repositories/12/files/README.md');
          await select('guide.md');

          await go('/repositories/12/files/docs/guide.md');

          expect(diffView()).toBeNull();
          expect(editorArea().hidden).toBe(false);
        });

        it('stays when the open file is deleted, which only closes it', async () => {
          await visit('/repositories/12/files/README.md');
          await select('guide.md');

          await TestBed.inject(Router).navigate([ '/repositories', 12 ], { replaceUrl: true, state: { closed: true } });
          await settle(harness.fixture);

          expect(diffView()).not.toBeNull();
          expect(editorArea().hidden).toBe(true);
        });

        it('stays when the open file is renamed, which replaces the URL', async () => {
          await visit('/repositories/12/files/README.md');
          await select('guide.md');

          await TestBed.inject(Router).navigate([ '/repositories', 12, 'files', 'logo.png' ], { replaceUrl: true });
          await settle(harness.fixture);

          expect(diffView()).not.toBeNull();
        });

        it('ends when another repository opens, even with a replaced URL', async () => {
          await visit('/repositories/12/files/README.md');
          await select('guide.md');

          await TestBed.inject(Router).navigate([ '/repositories', 13 ], { replaceUrl: true });
          await settle(harness.fixture);

          expect(diffView()).toBeNull();
        });

        it('ends when the open file is selected again in the tree', async () => {
          localStorage.setItem('fb.4.sideTool', 'files');
          await visit('/repositories/12/files/README.md');
          changesItem().click();
          await settle(harness.fixture);
          await select('guide.md');
          files().click();
          await settle(harness.fixture);

          row('README.md').click();
          await settle(harness.fixture);

          expect(diffView()).toBeNull();
          expect(editorArea().hidden).toBe(false);
        });

        it('ends on Open in editor, which opens the file', async () => {
          gitDiff.mockReturnValue(of<GitDiff>({
            kind: 'text',
            lines: [ { type: 'added', oldLine: null, newLine: 1, text: 'new' } ],
            complete: true,
            lineEndingsOnly: false
          }));
          await visit('/repositories/12/files/README.md');
          await select('guide.md');

          (page().querySelector('rs-diff-view .head button') as HTMLButtonElement).click();
          await settle(harness.fixture);

          expect(diffView()).toBeNull();
          expect(url()).toBe('/repositories/12/files/docs/guide.md');
        });

        it('closes the drawer on narrow screens', async () => {
          narrow = true;
          await visit('/repositories/12/files/README.md');
          changesItem().click();
          await settle(harness.fixture);
          expect(shown(tree())).toBe(true);

          await select('guide.md');

          expect(shown(tree())).toBe(false);
          expect(diffView()).not.toBeNull();
        });
      });

      it('says plain Changes when there are none', async () => {
        await visit('/repositories/12');

        expect(changesItem().getAttribute('aria-label')).toBe(`${KEY}.changes`);
        expect(changesItem().querySelector('.change-count')).toBeNull();
      });

      it('shortens a very large count, which the label says in full', async () => {
        changes = Array.from({ length: 120 }, (_, index) => ({ path: `f${index}.md`, state: 'added' as const }));
        await visit('/repositories/12');

        expect(changesItem().querySelector('.change-count')?.getAttribute('data-count')).toBe('99+');
      });

      it('switches between Files and Changes, and collapses with the selected one', async () => {
        await visit('/repositories/12');
        expect(shownOnly()).toBe('files');

        changesItem().click();
        await settle(harness.fixture);
        expect(shownOnly()).toBe('changes');
        expect(shown(tree())).toBe(true);
        expect(tree().getAttribute('aria-label')).toBe(`${KEY}.changes`);
        expect(changesItem().getAttribute('aria-pressed')).toBe('true');
        expect(pressed()).toBe('false');
        expect(localStorage.getItem('fb.4.sideTool')).toBe('changes');

        changesItem().click();
        await settle(harness.fixture);
        expect(shown(tree())).toBe(false);
        expect(changesItem().getAttribute('aria-pressed')).toBe('false');
        expect(localStorage.getItem('fb.4.repositoryScreen.sideOpen')).toBe('false');

        files().click();
        await settle(harness.fixture);
        expect(shown(tree())).toBe(true);
        expect(shownOnly()).toBe('files');
        expect(pressed()).toBe('true');
        expect(tree().getAttribute('aria-label')).toBe(`${KEY}.files`);
      });

      it('switches between Files and Changes in the drawer on narrow screens', async () => {
        narrow = true;
        await visit('/repositories/12');

        changesItem().click();
        await settle(harness.fixture);
        expect(shown(tree())).toBe(true);
        expect(shownOnly()).toBe('changes');
        expect(changesItem().getAttribute('aria-pressed')).toBe('true');

        files().click();
        await settle(harness.fixture);
        expect(shown(tree())).toBe(true);
        expect(shownOnly()).toBe('files');
        expect(pressed()).toBe('true');

        files().click();
        await settle(harness.fixture);
        expect(shown(tree())).toBe(false);
        expect(pressed()).toBe('false');
        // The drawer does not collapse the pane of wide screens.
        expect(localStorage.getItem('fb.4.repositoryScreen.sideOpen')).toBe('true');
      });

      it('says so on the item when a read failed', async () => {
        gitStatusAnswer = throwError(() => new HttpErrorResponse({ status: 500 }));
        await visit('/repositories/12');

        expect(changesItem().getAttribute('aria-label')).toBe(`${KEY}.changesFailed`);
        expect(changesItem().querySelector('.change-count')?.getAttribute('data-count')).toBe('!');
      });

      it('meets a focus request of the tree while Changes is shown, not later', async () => {
        await visit('/repositories/12');
        changesItem().click();
        await settle(harness.fixture);
        const store = harness.fixture.debugElement.query(By.directive(RepositoryScreenPage)).injector
          .get(FileTreeStoreService);

        store.focusRequest.set('README.md');
        await settle(harness.fixture);

        expect(store.focusRequest()).toBeNull();
      });

      it('keeps the expanded folders when the tree comes back', async () => {
        await visit('/repositories/12/files/docs/guide.md');

        changesItem().click();
        await settle(harness.fixture);
        files().click();
        await settle(harness.fixture);
        await settle(harness.fixture);

        const names = [ ...page().querySelectorAll('rs-file-tree [role="treeitem"]') ].map(row => row.textContent);
        expect(names.some(name => name?.includes('guide.md'))).toBe(true);
      });

      it('updates the count without a reload', async () => {
        await visit('/repositories/12');
        expect(changesItem().querySelector('.change-count')).toBeNull();

        changes = THREE;
        events.next({ type: 'git.changed', repositoryId: 12 });
        await settle(harness.fixture);

        expect(changesItem().querySelector('.change-count')?.getAttribute('data-count')).toBe('3');
      });
    });

    describe('the branch in the bar', () => {
      const summary = () =>
        page().querySelector('rs-repository-bar rs-git-status-summary')?.textContent?.replace(/\s+/g, ' ').trim();

      it('shows the branch from the status', async () => {
        await visit('/repositories/12');

        expect(summary()).toBe(
          'main · web-feature-repository-screen.GitStatusSummaryComponent.notPublished'
        );
      });

      it('keeps showing the last status', async () => {
        await visit('/repositories/12');
        const before = summary();

        gitStatusAnswer = throwError(() => new HttpErrorResponse({ status: 500 }));
        events.next({ type: 'git.changed', repositoryId: 12 });
        await settle(harness.fixture);

        expect(summary()).toBe(before);
        expect(before).toContain('main');
      });

      const branchButton = () => page().querySelector('rs-git-status-summary button') as HTMLButtonElement;
      const list = () => overlay().querySelector('rs-branch-list');

      it('opens the list from the branch', async () => {
        await visit('/repositories/12');

        branchButton().click();
        await settleDialog();

        expect(list()).not.toBeNull();
        expect(gitBranches).toHaveBeenCalledExactlyOnceWith(12);
      });

      it('opens the list on a phone', async () => {
        narrow = true;
        await visit('/repositories/12');

        branchButton().click();
        await settleDialog();

        expect(list()).not.toBeNull();
      });

      it('reads the list again each time it opens', async () => {
        await visit('/repositories/12');

        branchButton().click();
        await settleDialog();
        TestBed.inject(DialogService).closeAll();
        await settleDialog();
        branchButton().click();
        await settleDialog();

        expect(gitBranches).toHaveBeenCalledTimes(2);
      });

      it('returns focus to the button', async () => {
        await visit('/repositories/12');
        branchButton().focus();

        branchButton().click();
        await settleDialog();
        expect(document.activeElement).not.toBe(branchButton());

        overlay().querySelector<HTMLButtonElement>('li button')?.click();
        await settleDialog();

        expect(list()).toBeNull();
        expect(document.activeElement).toBe(branchButton());
      });

      it('switches to the branch selected in the list', async () => {
        gitBranches.mockReturnValue(of<GitBranchList>({
          current: 'main',
          local: [ { name: 'docs', upstream: null } ],
          remote: [],
          singleBranch: false
        }));
        await visit('/repositories/12');

        branchButton().click();
        await settleDialog();
        overlay().querySelector<HTMLButtonElement>('li button')?.click();
        await settleDialog();

        expect(switchBranch).toHaveBeenCalledExactlyOnceWith(12, { name: 'docs', remote: false });
      });

      it('shows Changes when asked to from a refused switch', async () => {
        gitBranches.mockReturnValue(of<GitBranchList>({
          current: 'main',
          local: [ { name: 'docs', upstream: null } ],
          remote: [],
          singleBranch: false
        }));
        switchBranch.mockReturnValue(failure(409, 'switch-uncommitted-changes'));
        await visit('/repositories/12');
        expect(page().querySelector('rs-changes-pane')?.hasAttribute('hidden')).toBe(true);

        branchButton().click();
        await settleDialog();
        overlay().querySelector<HTMLButtonElement>('li button')?.click();
        await settleDialog();
        dialogButton('web-feature-repository-screen.SwitchRefusedDialog.showChanges')?.click();
        await settle(harness.fixture);
        await settleDialog();

        expect(overlay().querySelector('rs-switch-refused')).toBeNull();
        expect(page().querySelector('rs-changes-pane')?.hasAttribute('hidden')).toBe(false);
      });

      it('closes the list when a merge starts, and gives the focus to the merge bar', async () => {
        await visit('/repositories/12');
        branchButton().focus();
        branchButton().click();
        await settleDialog();

        gitStatusAnswer = of({ ...baseStatus(), mergeInProgress: true });
        events.next({ type: 'git.changed', repositoryId: 12 });
        await settle(harness.fixture);
        await settleDialog();

        expect(list()).toBeNull();
        expect(document.activeElement?.closest('rs-merge-summary')).not.toBeNull();
      });

      it('leaves an open list alone when the status changes without a merge', async () => {
        await visit('/repositories/12');
        branchButton().click();
        await settleDialog();

        gitStatusAnswer = of({ ...baseStatus(), ahead: 1 });
        events.next({ type: 'git.changed', repositoryId: 12 });
        await settle(harness.fixture);
        await settleDialog();

        expect(list()).not.toBeNull();
      });
    });

    describe('a merge in progress', () => {
      const K = 'web-feature-repository-screen.AbortMergeDialog';
      const merging = () => page().querySelector('rs-merge-summary');

      it('switches the bar without a reload, and back after Abort merge', async () => {
        await visit('/repositories/12');
        expect(merging()).toBeNull();

        gitStatusAnswer = of({ ...baseStatus(), mergeInProgress: true });
        events.next({ type: 'git.changed', repositoryId: 12 });
        await settle(harness.fixture);

        expect(merging()?.textContent).toContain('origin/main');
        expect(page().querySelector('rs-git-actions')).toBeNull();

        (merging()?.querySelector('button') as HTMLButtonElement).click();
        await settleDialog();
        expect(abortMerge).not.toHaveBeenCalled();

        gitStatusAnswer = of(baseStatus());
        dialogButton(`${K}.abort`)?.click();
        await settleDialog();
        await settle(harness.fixture);

        expect(abortMerge).toHaveBeenCalledExactlyOnceWith(12);
        expect(merging()).toBeNull();
        expect(page().querySelector('rs-git-actions')).not.toBeNull();
      });

      describe('the conflict list', () => {
        const conflict = (path: string, resolved = false): GitConflictFile => ({
          path,
          kind: 'both-changed',
          resolved,
          editable: true,
          edited: false,
          oursSize: 1,
          theirsSize: 1
        });
        const conflictList = () => page().querySelector('rs-conflict-list') as HTMLElement | null;
        const conflictFile = () => page().querySelector('rs-conflict-file h2')?.textContent?.trim();
        const editorArea = () => page().querySelector('rs-editor-area') as HTMLElement;
        const fileTree = () => page().querySelector('rs-file-tree') as HTMLElement;
        const changesPane = () => page().querySelector('rs-changes-pane') as HTMLElement;
        const item = (name: string) =>
          page().querySelector(`ui-activity-bar button[uiActivityBarItem="${name}"]`) as HTMLButtonElement | null;
        const entryButton = (name: string) =>
          [ ...page().querySelectorAll<HTMLButtonElement>('rs-conflict-list .entry') ].find(entry =>
            entry.querySelector('.name')?.textContent?.trim() === name
          ) as HTMLButtonElement;

        async function startMerge(): Promise<void> {
          gitStatusAnswer = of({ ...baseStatus(), mergeInProgress: true });
          events.next({ type: 'git.changed', repositoryId: 12 });
          await settle(harness.fixture);
          await settle(harness.fixture);
        }

        async function endMerge(): Promise<void> {
          gitStatusAnswer = of(baseStatus());
          events.next({ type: 'git.changed', repositoryId: 12 });
          await settle(harness.fixture);
          await settle(harness.fixture);
        }

        beforeEach(() => {
          mergeAnswer = {
            ...mergeAnswer,
            files: [ conflict('README.md', true), conflict('docs/guide.md') ],
            otherFiles: [ 'logo.png' ]
          };
        });

        it('replaces the tree and Changes, keeping them in place, and goes back when the merge ends', async () => {
          await visit('/repositories/12/files/README.md');

          await startMerge();

          expect(conflictList()).not.toBeNull();
          expect(fileTree().hidden).toBe(true);
          expect(changesPane().hidden).toBe(true);
          expect(page().querySelector('ui-island[uiAppShellSide]')?.getAttribute('aria-label')).toBe(
            `${KEY}.conflicts`
          );
          expect(item('files')).toBeNull();
          expect(item('changes')).toBeNull();
          expect(item('conflicts')?.getAttribute('aria-pressed')).toBe('true');
          expect(editorArea().hidden).toBe(true);

          await endMerge();

          expect(conflictList()).toBeNull();
          expect(fileTree().hidden).toBe(false);
          expect(item('files')?.getAttribute('aria-pressed')).toBe('true');
          expect(item('conflicts')).toBeNull();
          expect(editorArea().hidden).toBe(false);
          expect(page().querySelector('rs-conflict-file')).toBeNull();
        });

        it('keeps the remembered tool window for after the merge', async () => {
          localStorage.setItem('fb.4.sideTool', 'changes');
          await visit('/repositories/12');
          await startMerge();

          // Collapsed and opened again, as the other items do.
          item('conflicts')?.click();
          await settle(harness.fixture);
          expect(conflictList()?.closest('[hidden]')).not.toBeNull();
          expect(item('conflicts')?.getAttribute('aria-pressed')).toBe('false');
          item('conflicts')?.click();
          await settle(harness.fixture);
          await endMerge();

          expect(changesPane().hidden).toBe(false);
          expect(localStorage.getItem('fb.4.sideTool')).toBe('changes');
        });

        it('selects the first unresolved file, and shows the one selected', async () => {
          await visit('/repositories/12');
          await startMerge();

          expect(conflictFile()).toBe('guide.md');
          expect(entryButton('guide.md').getAttribute('aria-current')).toBe('true');

          entryButton('README.md').click();
          await settle(harness.fixture);

          expect(conflictFile()).toBe('README.md');
          expect(entryButton('README.md').getAttribute('aria-current')).toBe('true');
        });

        it('names the conflicting file shown in the title, and the route\'s file again after the merge', async () => {
          await visit('/repositories/12/files/README.md');
          expect(document.title).toBe('README.md · handbook · Front Burner');

          await startMerge();
          expect(document.title).toBe('guide.md · handbook · Front Burner');

          entryButton('README.md').click();
          await settle(harness.fixture);
          expect(document.title).toBe('README.md · handbook · Front Burner');

          await endMerge();
          expect(document.title).toBe('README.md · handbook · Front Burner');
        });

        it('moves the selection when the file leaves the list', async () => {
          mergeAnswer = { ...mergeAnswer, files: [ conflict('a.md'), conflict('b.md'), conflict('c.md') ] };
          await visit('/repositories/12');
          await startMerge();
          entryButton('b.md').click();
          await settle(harness.fixture);

          mergeAnswer = { ...mergeAnswer, files: [ conflict('a.md'), conflict('c.md') ] };
          events.next({ type: 'git.changed', repositoryId: 12 });
          await settle(harness.fixture);

          expect(conflictFile()).toBe('c.md');
        });

        it('hides the diff during a merge', async () => {
          changes = [ { path: 'docs/guide.md', state: 'modified' } ];
          localStorage.setItem('fb.4.sideTool', 'changes');
          await visit('/repositories/12/files/README.md');
          (page().querySelector('rs-change-entry .entry') as HTMLButtonElement).click();
          await settle(harness.fixture);
          expect(page().querySelector('rs-diff-view')).not.toBeNull();

          await startMerge();
          expect(page().querySelector('rs-diff-view')).toBeNull();

          await endMerge();
          expect(page().querySelector('rs-diff-view')).toBeNull();
          expect(editorArea().hidden).toBe(false);
          expect(TestBed.inject(Router).url).toBe('/repositories/12/files/README.md');
        });

        it('is in the drawer on a phone, and selecting closes it', async () => {
          narrow = true;
          await visit('/repositories/12');
          await startMerge();
          expect(conflictList()?.closest('[hidden]')).not.toBeNull();

          item('conflicts')?.click();
          await settle(harness.fixture);
          expect(conflictList()?.closest('[hidden]')).toBeNull();

          entryButton('README.md').click();
          await settle(harness.fixture);

          expect(item('conflicts')?.getAttribute('aria-pressed')).toBe('false');
          expect(conflictFile()).toBe('README.md');
        });

        it('keeps focus in the side pane when the bar goes', async () => {
          await visit('/repositories/12');
          item('changes')?.focus();
          expect(document.activeElement).toBe(item('changes'));

          await startMerge();

          expect(document.activeElement).toBe(entryButton('guide.md'));

          await endMerge();

          expect(document.activeElement).toBe(item('files'));
        });

        it('leaves the focus alone when it is elsewhere', async () => {
          await visit('/repositories/12');
          const bar = page().querySelector('rs-repository-bar button') as HTMLButtonElement;
          bar.focus();

          await startMerge();

          expect(document.activeElement).toBe(bar);
        });
      });
    });

    describe('the remote-change notice', () => {
      const notice = () => page().querySelector('rs-remote-change-notice');
      const NOTICE = 'web-feature-repository-screen.RemoteChangeNoticeComponent';
      const noticeButton = (text: string) =>
        [ ...(notice()?.querySelectorAll('button') ?? []) ].find(found =>
          found.textContent?.trim() === text || found.getAttribute('aria-label') === text
        ) as HTMLButtonElement;
      const fetchInBar = () =>
        ([ ...page().querySelectorAll<HTMLButtonElement>('rs-git-actions button') ]
          .find(found => found.textContent?.trim().endsWith('.fetch')) as HTMLButtonElement).click();

      beforeEach(() => {
        gitStatusAnswer = of({ ...baseStatus(), upstream: 'origin/main', behind: 3 });
      });

      it('shows below the bar, above the panes', async () => {
        await visit('/repositories/12');

        const shown = notice() as HTMLElement;
        expect(shown.closest('header')).toBeTruthy();
        expect(shown.previousElementSibling?.contains(page().querySelector('rs-repository-bar'))).toBe(true);
      });

      it('shows nothing when nothing is new', async () => {
        gitStatusAnswer = of({ ...baseStatus(), upstream: 'origin/main' });

        await visit('/repositories/12');

        expect(notice()).toBeNull();
      });

      it('Pull in the notice pulls', async () => {
        await visit('/repositories/12');

        noticeButton(`${NOTICE}.pull`).click();
        // The waiting saves go first.
        await settle(harness.fixture);
        await settle(harness.fixture);

        expect(pull).toHaveBeenCalledExactlyOnceWith(12);
      });

      it('Pull in the notice waits for the fetch that found the commits, which may not have ended yet', async () => {
        const started = new Subject<GitJobStarted>();
        fetch.mockReturnValue(started);
        gitJob.mockReturnValue(of<GitJobState>({
          status: 'done',
          outcome: { kind: 'fetched', moved: true, upstreamMoved: true }
        }));
        await visit('/repositories/12');
        fetchInBar();
        await settle(harness.fixture);

        noticeButton(`${NOTICE}.pull`).click();
        await settle(harness.fixture);
        expect(pull).not.toHaveBeenCalled();

        started.next({ jobId: 9 });
        started.complete();
        await settle(harness.fixture);
        await settle(harness.fixture);
        await settle(harness.fixture);

        expect(pull).toHaveBeenCalledExactlyOnceWith(12);
      });

      it('goes when dismissed, and the focus goes to the git actions', async () => {
        await visit('/repositories/12');
        const dismiss = noticeButton(`${NOTICE}.dismiss`);
        dismiss.focus();

        dismiss.click();
        await settle(harness.fixture);

        expect(notice()).toBeNull();
        expect(document.activeElement?.closest('rs-git-actions')).toBeTruthy();
      });

      it('going away by itself does not take the focus', async () => {
        const statuses = new BehaviorSubject<GitStatus>({ ...baseStatus(), upstream: 'origin/main', behind: 3 });
        gitStatusAnswer = statuses.pipe(take(1));
        await visit('/repositories/12');
        const elsewhere = page().querySelector<HTMLButtonElement>('rs-file-tree button') as HTMLButtonElement;
        elsewhere.focus();

        statuses.next({ ...baseStatus(), upstream: 'origin/main' });
        gitStatusAnswer = statuses.pipe(take(1));
        events.next({ type: 'git.changed', repositoryId: 12 });
        await settle(harness.fixture);

        expect(notice()).toBeNull();
        expect(document.activeElement).toBe(elsewhere);
      });

      it('Pull shows that it waits for the running job', async () => {
        fetch.mockReturnValue(new Subject<GitJobStarted>());
        await visit('/repositories/12');
        fetchInBar();
        await settle(harness.fixture);

        noticeButton(`${NOTICE}.pull`).click();
        await settle(harness.fixture);

        expect(noticeButton(`${NOTICE}.waiting`).getAttribute('aria-disabled')).toBe('true');
        expect(pull).not.toHaveBeenCalled();
      });
    });

    describe('a locked key', () => {
      const banner = () => page().querySelector('rs-locked-key-banner');
      const BANNER = 'web-feature-repository-screen.LockedKeyBannerComponent';

      beforeEach(() => {
        credentialsInfo = {
          protocol: 'ssh',
          inUse: {
            kind: 'ssh-key',
            id: 3,
            name: 'laptop',
            keyType: 'ed25519',
            fingerprint: 'SHA256:abc',
            passphraseProtected: true,
            unlocked: false,
            generated: false,
            missing: false,
            usedBy: 1
          }
        };
      });

      it('shows the banner below the bar, and Unlock removes it after the unlock', async () => {
        await visit('/repositories/12');

        const shown = banner() as HTMLElement;
        expect(shown.closest('header')).toBeTruthy();
        expect(shown.closest('rs-repository-bar')).toBeNull();
        expect(shown.textContent).toContain(`${BANNER}.message`);

        (shown.querySelector('[uiBannerActions] button') as HTMLButtonElement).click();
        await settleDialog();
        const input = document.querySelector('dlg-unlock-key input') as HTMLInputElement;
        input.value = 'correct horse';
        input.dispatchEvent(new Event('input'));
        await settleDialog();
        dialogButton('web-repository-dialogs.UnlockKeyDialog.unlock')?.click();
        await settleDialog();
        await settle(harness.fixture);

        expect(unlockSshKey).toHaveBeenCalledWith(3, { passphrase: 'correct horse' });
        expect(banner()).toBeNull();
      });

      it('can be dismissed', async () => {
        await visit('/repositories/12');

        (banner()?.querySelector(`button[aria-label="${BANNER}.dismiss"]`) as HTMLButtonElement).click();
        await settle(harness.fixture);

        expect(banner()).toBeNull();
      });
    });

    describe('the quiet fetch status', () => {
      const STATUS = 'web-feature-repository-screen.FetchStatusComponent';
      const FIXES = 'web-feature-repository-screen.GitProblemComponent.fixes';
      const status = () => page().querySelector('rs-repository-bar rs-fetch-status') as HTMLElement;
      const statusButton = (label: string) =>
        [ ...status().querySelectorAll('button') ].find(found =>
          found.textContent?.trim() === label
        ) as HTMLButtonElement;
      const anyDialog = () => document.querySelector('[role="dialog"]:not([hidden])');
      const failedFetch = (code: string, params: Record<string, string> = {}): GitStatus => ({
        ...baseStatus(),
        fetchProblem: { code, params }
      });
      const lockedInfo = (): RepositoryCredentialsInfo => ({
        protocol: 'ssh',
        inUse: {
          kind: 'ssh-key',
          id: 3,
          name: 'laptop',
          keyType: 'ed25519',
          fingerprint: 'SHA256:abc',
          passphraseProtected: true,
          unlocked: false,
          generated: false,
          missing: false,
          usedBy: 1
        }
      });

      it('AC-GIT-002.14: a failed background fetch shows Couldn\'t check for remote changes in the header and opens no dialog', async () => {
        gitStatusAnswer = of(failedFetch('network'));
        await visit('/repositories/12');

        expect(status().closest('header')).toBeTruthy();
        expect(status().textContent).toContain(`${STATUS}.failed`);
        expect(status().textContent).toContain('errors.network');
        expect(anyDialog()).toBeNull();
        // Not the banner of a fetch the user pressed.
        expect(page().querySelector('rs-git-problem')).toBeNull();
      });

      it.each([
        'no-credentials',
        'credentials-missing',
        'credentials-refused',
        'host-key-changed',
        'host-key-unknown'
      ])(
        'AC-REPO-002.13: a background fetch that meets %s shows it only in the header\'s quiet status and opens no dialog',
        async code => {
          gitStatusAnswer = of(failedFetch(code, { host: 'github.com' }));
          await visit('/repositories/12');

          expect(status().textContent).toContain(`errors.${code}`);
          expect(anyDialog()).toBeNull();
          expect(page().querySelector('rs-git-problem')).toBeNull();
        }
      );

      it('AC-REPO-002.13: a background fetch that meets a locked key shows it only in the header\'s quiet status and opens no dialog', async () => {
        credentialsInfo = lockedInfo();
        await visit('/repositories/12');

        expect(status().textContent).toContain(`${STATUS}.locked`);
        expect(anyDialog()).toBeNull();
        expect(page().querySelector('rs-git-problem')).toBeNull();
      });

      it('a locked key comes before a stored problem', async () => {
        credentialsInfo = lockedInfo();
        gitStatusAnswer = of(failedFetch('credentials-refused'));
        await visit('/repositories/12');

        expect(status().textContent).toContain(`${STATUS}.locked`);
        expect(status().textContent).not.toContain('errors.credentials-refused');
      });

      it('goes away when the next fetch succeeds', async () => {
        gitStatusAnswer = of(failedFetch('network'));
        await visit('/repositories/12');
        expect(status().textContent).toContain('errors.network');

        gitStatusAnswer = of(baseStatus());
        events.next({ type: 'git.changed', repositoryId: 12 });
        await settle(harness.fixture);
        await settle(harness.fixture);

        expect(status().textContent?.trim()).toBe('');
      });

      it('stays after the banner is dismissed', async () => {
        credentialsInfo = lockedInfo();
        await visit('/repositories/12');

        const banner = page().querySelector('rs-locked-key-banner') as HTMLElement;
        (banner.querySelector('button[aria-label$=".dismiss"]') as HTMLButtonElement).click();
        await settle(harness.fixture);

        expect(page().querySelector('rs-locked-key-banner')).toBeNull();
        expect(status().textContent).toContain(`${STATUS}.locked`);

        statusButton(`${FIXES}.unlock`).click();
        await settleDialog();

        expect(document.querySelector('dlg-unlock-key')).not.toBeNull();
      });

      it('a pressed fetch that failed shows the banner and this status', async () => {
        gitStatusAnswer = of(baseStatus());
        gitJob.mockReturnValue(of<GitJobState>({
          status: 'done',
          outcome: { kind: 'failed', code: 'network', params: {} }
        }));
        await visit('/repositories/12');
        gitStatusAnswer = of(failedFetch('network'));

        fetch.mockReturnValue(of({ jobId: 8 }));
        (page().querySelector('rs-git-actions button') as HTMLButtonElement).click();
        await settle(harness.fixture);
        await settle(harness.fixture);

        expect(page().querySelector('rs-git-problem')?.textContent).toContain('errors.network');
        expect(status().textContent).toContain('errors.network');
      });

      it('Try again fetches', async () => {
        gitStatusAnswer = of(failedFetch('network'));
        await visit('/repositories/12');

        statusButton(`${FIXES}.retry`).click();
        await settle(harness.fixture);

        expect(fetch).toHaveBeenCalledExactlyOnceWith(12);
        expect(push).not.toHaveBeenCalled();
      });

      it('Try again that succeeds leaves the focus on the git actions', async () => {
        gitStatusAnswer = of(failedFetch('network'));
        await visit('/repositories/12');
        statusButton(`${FIXES}.retry`).focus();

        gitStatusAnswer = of(baseStatus());
        events.next({ type: 'git.changed', repositoryId: 12 });
        await settle(harness.fixture);
        await settle(harness.fixture);

        expect(status().textContent?.trim()).toBe('');
        expect(document.activeElement).toBe(page().querySelector('rs-git-actions button'));
      });

      it('Try again is unavailable while a push runs', async () => {
        gitStatusAnswer = of({ ...failedFetch('network'), networkJob: { id: 9, type: 'push' } });
        await visit('/repositories/12');

        statusButton(`${FIXES}.retry`).click();
        await settle(harness.fixture);

        expect(statusButton(`${FIXES}.retry`).getAttribute('aria-disabled')).toBe('true');
        expect(fetch).not.toHaveBeenCalled();
      });

      it('shows the locked key when key.locked says the unlock ended while the screen was open', async () => {
        await visit('/repositories/12');
        expect(status().textContent?.trim()).toBe('');

        credentialsInfo = lockedInfo();
        events.next({ type: 'key.locked', keyId: 3 });
        await settle(harness.fixture);
        await settle(harness.fixture);

        expect(status().textContent).toContain(`${STATUS}.locked`);
        expect(anyDialog()).toBeNull();
      });

      it('the fix opens the dialog for its code', async () => {
        gitStatusAnswer = of(failedFetch('host-key-changed', {
          host: 'git.example.com',
          port: '22',
          type: 'ssh-ed25519',
          key: 'AAAAC3NzaC1lZDI1NTE5AAAAIH',
          fingerprint: 'SHA256:new',
          trustedType: 'ssh-rsa',
          trustedFingerprint: 'SHA256:old'
        }));
        await visit('/repositories/12');

        statusButton(`${FIXES}.review-host-key`).click();
        await settleDialog();

        expect(document.querySelector('dlg-changed-host-key')?.textContent).toContain('SHA256:new');
      });

      it('shows it after the git actions and before the save status, also on a phone (NV-11)', async () => {
        gitStatusAnswer = of(failedFetch('network'));
        narrow = true;
        await visit('/repositories/12');

        const parts = [ ...page().querySelectorAll('rs-git-actions, rs-fetch-status, rs-save-status') ];
        expect(parts.map(part => part.localName)).toEqual([ 'rs-git-actions', 'rs-fetch-status', 'rs-save-status' ]);
      });
    });

    describe('pushing', () => {
      const KEY_ACTIONS = 'web-feature-repository-screen.GitActionsComponent';
      const pushButton = () =>
        [ ...page().querySelectorAll('rs-repository-bar rs-git-actions button') ]
          .find(button => button.textContent?.trim().startsWith(`${KEY_ACTIONS}.push`)) as HTMLButtonElement;
      const fetchButton = () =>
        [ ...page().querySelectorAll('rs-repository-bar rs-git-actions button') ]
          .find(button => button.textContent?.trim().startsWith(`${KEY_ACTIONS}.fetch`)) as HTMLButtonElement;
      const problem = () => page().querySelector('rs-git-problem');

      it('fetches from the bar and shows it running, with Push unavailable', async () => {
        await visit('/repositories/12');

        fetchButton().click();
        await settle(harness.fixture);

        expect(fetch).toHaveBeenCalledExactlyOnceWith(12);
        expect(fetchButton().textContent?.trim()).toBe(`${KEY_ACTIONS}.fetching`);
        expect(pushButton().getAttribute('aria-disabled')).toBe('true');
      });

      it('shows another tab\'s fetch as running on the page', async () => {
        gitStatusAnswer = of({ ...baseStatus(), networkJob: { id: 9, type: 'fetch' } });
        await visit('/repositories/12');

        expect(fetchButton().textContent?.trim()).toBe(`${KEY_ACTIONS}.fetching`);
        expect(pushButton().getAttribute('aria-disabled')).toBe('true');
      });

      it('shows a fetch that failed in another tab as a banner', async () => {
        gitStatusAnswer = of({ ...baseStatus(), networkJob: { id: 9, type: 'fetch' } });
        gitJob.mockReturnValue(of<GitJobState>({
          status: 'failed',
          outcome: { kind: 'failed', code: 'network', params: {} }
        }));
        await visit('/repositories/12');

        expect((problem() as HTMLElement).textContent).toContain('errors.network');
        expect(fetchButton().getAttribute('aria-disabled')).toBeNull();
      });

      it('shows a failed fetch as a banner, and Try again fetches again', async () => {
        gitJob.mockReturnValue(of<GitJobState>({
          status: 'done',
          outcome: { kind: 'failed', code: 'network', params: {} }
        }));
        await visit('/repositories/12');
        fetchButton().click();
        await settle(harness.fixture);

        const first = problem() as HTMLElement;
        expect(first.textContent).toContain('errors.network');
        expect(first.querySelector('ui-inline-banner')).not.toBeNull();

        (first.querySelector('[uiBannerActions] button') as HTMLButtonElement).click();
        await settle(harness.fixture);

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(push).not.toHaveBeenCalled();
      });

      it('pushes from the bar and shows it running', async () => {
        await visit('/repositories/12');

        pushButton().click();
        await settle(harness.fixture);

        expect(push).toHaveBeenCalledExactlyOnceWith(12);
        expect(pushButton().textContent?.trim()).toBe(`${KEY_ACTIONS}.pushing`);
      });

      it('shows a new banner for each failure, so that Try again that fails again is announced', async () => {
        push.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
        await visit('/repositories/12');
        pushButton().click();
        await settle(harness.fixture);
        const first = problem() as HTMLElement;
        expect(first.textContent).toContain('errors.network');

        (first.querySelector('[uiBannerActions] button') as HTMLButtonElement).click();
        await settle(harness.fixture);

        expect(push).toHaveBeenCalledTimes(2);
        expect(problem()).toBeTruthy();
        expect(problem()).not.toBe(first);
      });

      it('Show changes opens Changes', async () => {
        localStorage.setItem('fb.4.sideTool', 'files');
        gitStatusAnswer = of({ ...baseStatus(), upstream: 'origin/main' });
        pull.mockReturnValue(throwError(() =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'uncommitted-changes', params: {}, message: 'x', requestId: 'r' }
          })
        ));
        await visit('/repositories/12');

        const pullButton = [ ...page().querySelectorAll('rs-repository-bar rs-git-actions button') ]
          .find(button => button.textContent?.trim() === `${KEY_ACTIONS}.pull`) as HTMLButtonElement;
        pullButton.click();
        // The waiting saves go first.
        await settle(harness.fixture);
        await settle(harness.fixture);

        const shown = problem() as HTMLElement;
        expect(shown.textContent).toContain('errors.uncommitted-changes');
        const fix = [ ...shown.querySelectorAll('button') ]
          .find(button => button.textContent?.includes('fixes.show-changes')) as HTMLButtonElement;
        fix.click();
        await settle(harness.fixture);

        expect(page().querySelector('rs-changes-pane')?.hasAttribute('hidden')).toBe(false);
        expect(page().querySelector('rs-file-tree')?.hasAttribute('hidden')).toBe(true);
      });

      it('shows why a push failed below the bar, above the panes, and dismisses it', async () => {
        gitJob.mockReturnValue(of<GitJobState>({
          status: 'done',
          outcome: { kind: 'failed', code: 'push-rejected', params: { branch: 'main' } }
        }));
        await visit('/repositories/12');

        pushButton().click();
        await settle(harness.fixture);

        const shown = problem() as HTMLElement;
        expect(shown.closest('header')).toBeTruthy();
        expect(shown.closest('rs-repository-bar')).toBeNull();
        expect(shown.textContent).toContain('errors.push-rejected');

        (shown.querySelector('ui-inline-banner button') as HTMLButtonElement).click();
        await settle(harness.fixture);
        expect(problem()).toBeNull();
      });
    });

    it('has one pressed Files item with a folder icon in the activity bar', async () => {
      await visit('/repositories/12');

      const bar = page().querySelector('ui-activity-bar') as HTMLElement;
      expect(bar.getAttribute('aria-label')).toBe(`${KEY}.toolWindows`);
      expect(bar.querySelectorAll('button')).toHaveLength(2);
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

    it('moves the focus to the named Files region when the drawer opens', async () => {
      narrow = true;
      await visit('/repositories/12');

      files().click();
      await settle(harness.fixture);

      const active = document.activeElement as HTMLElement;
      expect(active).toBe(tree());
      expect(active.getAttribute('role')).toBe('region');
      expect(active.getAttribute('aria-label')).toBe(`${KEY}.files`);
    });

    it('shows the bar without Files for a repository that cannot be opened', async () => {
      answers.push(of({ ...handbook, status: 'cloning' }));
      await visit('/repositories/12');

      expect(page().querySelector('header rs-repository-bar h1')?.textContent?.trim()).toBe('handbook');
      expect(files()).toBeNull();
      expect(page().querySelector('ui-activity-bar')).toBeNull();
      expect(page().querySelector('ui-island[uiAppShellSide]')).toBeNull();
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

    it('holds a waiting save during a merge, as a browser draft, and sends it once the merge ends', async () => {
      await visit('/repositories/12/files/README.md');
      typeAtEnd('More.\n');

      gitStatusAnswer = of({ ...baseStatus(), mergeInProgress: true });
      events.next({ type: 'git.changed', repositoryId: 12 });
      await settle(harness.fixture);
      expect(drafts.at('README.md')?.content).toBe('# README.md\nMore.\n');

      // Hiding the tab sends the waiting saves at once (ED-17), but not during a merge.
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      try {
        document.dispatchEvent(new Event('visibilitychange'));
        await settle(harness.fixture);
      } finally {
        Reflect.deleteProperty(document, 'visibilityState');
      }
      expect(saveFile).not.toHaveBeenCalled();

      gitStatusAnswer = of(baseStatus());
      events.next({ type: 'git.changed', repositoryId: 12 });
      await settle(harness.fixture);

      expect(savedPaths()).toEqual([ 'README.md' ]);
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

    it('does not flush saves when pushing: a push sends what was committed', async () => {
      await visit('/repositories/12/files/README.md');
      typeAtEnd('More.\n');

      (page().querySelector('rs-repository-bar rs-git-actions button:last-of-type') as HTMLButtonElement).click();
      await settle(harness.fixture);

      expect(push).toHaveBeenCalledOnce();
      expect(saveFile).not.toHaveBeenCalled();
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

    it('flushes when a change is selected, so that its diff has the edit', async () => {
      changes = [ { path: 'README.md', state: 'modified' } ];
      localStorage.setItem('fb.4.sideTool', 'changes');
      await visit('/repositories/12/files/README.md');
      typeAtEnd('More.\n');
      expect(saveFile).not.toHaveBeenCalled();

      (page().querySelector('rs-change-entry button') as HTMLButtonElement).click();
      await settle(harness.fixture);

      expect(savedPaths()).toEqual([ 'README.md' ]);
    });

    it('reads the diff only after the waiting save has been answered', async () => {
      changes = [ { path: 'README.md', state: 'modified' } ];
      localStorage.setItem('fb.4.sideTool', 'changes');
      const answer = new Subject<{ hash: string; size: number; }>();
      saveFile.mockReturnValue(answer);
      await visit('/repositories/12/files/README.md');
      typeAtEnd('More.\n');

      (page().querySelector('rs-change-entry button') as HTMLButtonElement).click();
      await settle(harness.fixture);

      expect(savedPaths()).toEqual([ 'README.md' ]);
      expect(page().querySelector('rs-diff-view')).not.toBeNull();
      expect(gitDiff).not.toHaveBeenCalled();

      answer.next({ hash: 'b'.repeat(64), size: 10 });
      answer.complete();
      await settle(harness.fixture);

      expect(gitDiff).toHaveBeenCalledWith('README.md');
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
