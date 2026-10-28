import { BreakpointObserver } from '@angular/cdk/layout';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CurrentUser, FolderListing, RepositorySummary } from '@front-burner/shared-contracts';
import { FilesApi, RepositoriesApi } from '@front-burner/web-api-client';
import { AuthSessionService, CurrentUserService, PageTitleService } from '@front-burner/web-core';
import { Observable, of, Subject, throwError } from 'rxjs';

import { entry, folder, listing } from '../../../testing/listings';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { restoreLayout, stubViewportLayout } from '../../../testing/viewport-layout';
import { routes } from '../../repository-screen.routes';

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
  let harness: RouterTestingHarness;
  let narrow: boolean;

  const page = () => harness.fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [ ...page().querySelectorAll('button') ].find(element => element.textContent?.trim() === text);

  async function visit(url: string): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ translocoTesting({ 'errors.internal': 'Something went wrong.' }) ],
      providers: [
        provideRouter([ { path: 'repositories/:id', children: routes } ]),
        { provide: RepositoriesApi, useValue: { open } },
        {
          provide: FilesApi,
          useValue: {
            listFolder: (_id: number, query: { path: string; }) =>
              failOnce.delete(query.path)
                ? failure(500, 'internal')
                : folders[query.path]
                ? of(folders[query.path])
                : failure(404, 'entry-not-found')
          }
        },
        { provide: CurrentUserService, useValue: { user: signal(ada), load: () => Promise.resolve(ada) } },
        { provide: AuthSessionService, useValue: { loggedIn: signal(true), logout: vi.fn() } },
        {
          provide: BreakpointObserver,
          useValue: { observe: () => of({ matches: narrow, breakpoints: {} }), isMatched: () => narrow }
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
    localStorage.clear();
    open = vi.fn((id: number) => answers.shift() ?? of({ ...handbook, id }));
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

  it('AC-FILE-001.3: shows the status and the settings link for a cloning repository', async () => {
    answers.push(of({ ...handbook, status: 'cloning' }));
    await visit('/repositories/12');

    const notOpenable = page().querySelector('rs-not-openable') as HTMLElement;
    expect(notOpenable.textContent).toContain('web-feature-repository-screen.NotOpenableComponent.cloning');
    expect(notOpenable.querySelector('a')?.getAttribute('href')).toBe('/repositories/12/settings');
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
    const files = () => button('web-feature-repository-screen.RepositoryBarComponent.files') as HTMLButtonElement;
    const tree = () => page().querySelector('section[aria-label]') as HTMLElement;
    const shown = (element: Element) => !element.closest('[hidden]');

    afterEach(() => localStorage.clear());

    it('labels the regions', async () => {
      await visit('/repositories/12');

      expect(page().querySelector('header rs-repository-bar h1')?.textContent?.trim()).toBe('handbook');
      expect(tree().getAttribute('aria-label')).toBe(`${KEY}.files`);
      expect(page().querySelector('[role="separator"]')?.getAttribute('aria-label')).toBe(`${KEY}.resizeFiles`);
      expect(page().querySelector('main')?.getAttribute('aria-label')).toBe(`${KEY}.editor`);
      expect(page().querySelector('main rs-editor-area')).not.toBeNull();
    });

    const row = (name: string) =>
      [ ...page().querySelectorAll<HTMLElement>('[role="treeitem"]') ].find(item =>
        item.getAttribute('aria-label')?.startsWith(`${name},`)
      ) as HTMLElement;
    const url = () => TestBed.inject(Router).url;
    const editor = () => page().querySelector('main') as HTMLElement;
    const LATER = 'web-feature-repository-screen.EditorAreaComponent.later';
    const MESSAGE = 'web-feature-repository-screen.EntryMessageComponent';

    it('opens the README the first time', async () => {
      await visit('/repositories/12');

      expect(url()).toBe('/repositories/12/files/README.md');
      expect(editor().querySelector('h2')?.textContent?.trim()).toBe('README.md');
      expect(editor().textContent).toContain(LATER);
      expect(row('README.md').getAttribute('aria-selected')).toBe('true');
      expect(localStorage.getItem('fb.4.repo.12.lastFile')).toBe('README.md');
    });

    it('opens the last file on the same device', async () => {
      localStorage.setItem('fb.4.repo.12.lastFile', 'docs/guide.md');

      await visit('/repositories/12');

      expect(url()).toBe('/repositories/12/files/docs/guide.md');
      expect(row('docs').getAttribute('aria-expanded')).toBe('true');
      expect(row('guide.md').getAttribute('aria-selected')).toBe('true');
      expect(editor().querySelector('h2')?.textContent?.trim()).toBe('guide.md');
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
      expect(editor().textContent).not.toContain(LATER);
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

      expect(editor().querySelector('h2')?.textContent?.trim()).toBe('guide.md');
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
      expect(editor().querySelector('h2')?.textContent?.trim()).toBe('guide.md');
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

    it('collapses and expands the tree with Files, and remembers it', async () => {
      await visit('/repositories/12');
      expect(shown(tree())).toBe(true);
      expect(files().getAttribute('aria-expanded')).toBe('true');

      files().click();
      await settle(harness.fixture);

      expect(shown(tree())).toBe(false);
      expect(files().getAttribute('aria-expanded')).toBe('false');
      expect(localStorage.getItem('fb.4.repositoryScreen.sideOpen')).toBe('false');

      files().click();
      await settle(harness.fixture);
      expect(shown(tree())).toBe(true);
    });

    it('remembers the size of the tree', async () => {
      await visit('/repositories/12');
      const separator = page().querySelector('[role="separator"]') as HTMLElement;

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
      expect(files().getAttribute('aria-expanded')).toBe('false');

      files().click();
      await settle(harness.fixture);

      expect(shown(tree())).toBe(true);
      expect(files().getAttribute('aria-expanded')).toBe('true');
      // The drawer does not collapse the tree of wide screens.
      expect(localStorage.getItem('fb.4.repositoryScreen.sideOpen')).toBe('true');
    });

    it('shows the bar without Files for a repository that cannot be opened', async () => {
      answers.push(of({ ...handbook, status: 'cloning' }));
      await visit('/repositories/12');

      expect(page().querySelector('header rs-repository-bar h1')?.textContent?.trim()).toBe('handbook');
      expect(files()).toBeUndefined();
      expect(page().querySelector('section[aria-label]')).toBeNull();
    });
  });
});
