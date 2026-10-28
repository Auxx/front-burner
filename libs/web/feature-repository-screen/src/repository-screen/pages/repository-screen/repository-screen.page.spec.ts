import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CurrentUser, RepositorySummary } from '@front-burner/shared-contracts';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { AuthSessionService, CurrentUserService } from '@front-burner/web-core';
import { Observable, of, Subject, throwError } from 'rxjs';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
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
  let open: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;

  const page = () => harness.fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [ ...page().querySelectorAll('button') ].find(element => element.textContent?.trim() === text);

  async function visit(url: string): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ translocoTesting({ 'errors.internal': 'Something went wrong.' }) ],
      providers: [
        provideRouter([ { path: 'repositories/:id', children: routes } ]),
        { provide: RepositoriesApi, useValue: { open } },
        { provide: CurrentUserService, useValue: { user: signal(ada), load: () => Promise.resolve(ada) } },
        { provide: AuthSessionService, useValue: { loggedIn: signal(true), logout: vi.fn() } }
      ]
    });
    harness = await RouterTestingHarness.create();
    await go(url);
  }

  async function go(url: string): Promise<void> {
    await harness.navigateByUrl(url);
    await settle(harness.fixture);
  }

  beforeEach(() => {
    answers = [];
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

    answer.error(new HttpErrorResponse({ status: 404, error: { code: 'not-found', params: {}, requestId: '', message: '' } }));
    await settle(harness.fixture);

    expect(page().querySelector('shell-page-not-found h1')?.textContent?.trim()).toBe('web-shell.PageNotFoundPage.heading');
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

  it('titles the page with the repository name', async () => {
    await visit('/repositories/12');
    expect(document.title).toBe('handbook · Front Burner');

    // The title stays when only the open file changes.
    await go('/repositories/12/files/README.md');
    expect(document.title).toBe('handbook · Front Burner');
  });
});
