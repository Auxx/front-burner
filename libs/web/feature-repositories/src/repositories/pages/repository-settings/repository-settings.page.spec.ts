import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { PushEvent, RepositoryDetails } from '@front-burner/shared-contracts';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { PageTitleService, PushChannelService } from '@front-burner/web-core';
import { NEVER, Observable, of, Subject, throwError } from 'rxjs';

import { apiFailure } from '../../../testing/api-failure';
import { repositoryDetails } from '../../../testing/repository-details';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RepositorySettingsPage } from './repository-settings.page';

const KEY = 'web-feature-repositories.RepositorySettingsPage';

describe('RepositorySettingsPage', () => {
  let harness: RouterTestingHarness;
  let answers: Observable<RepositoryDetails>[];
  let requested: number[];
  let push: { events: Subject<PushEvent>; reconnected: Subject<void>; };

  const page = () => harness.routeNativeElement as HTMLElement;
  const crumbs = () => [ ...page().querySelectorAll('nav li') ].map(item => item.textContent?.trim());
  const crumbLinks = () => [ ...page().querySelectorAll<HTMLAnchorElement>('nav a') ];
  const heading = () => page().querySelector('h1');
  const openLink = () => page().querySelector<HTMLAnchorElement>('a.open');
  const status = () => page().querySelector('shell-repository-status');

  async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve));
    harness.detectChanges();
    await harness.fixture.whenStable();
  }

  async function open(url: string, ...replies: Observable<RepositoryDetails>[]): Promise<void> {
    answers = replies;
    const details = (id: number) => {
      requested.push(id);
      return answers.shift() ?? NEVER;
    };
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          [`${KEY}.title`]: 'Settings · {{ name }}',
          'web-shell.PageNotFoundPage.title': 'Page not found'
        })
      ],
      providers: [
        provideRouter([ { path: 'repositories/:id/settings', component: RepositorySettingsPage } ]),
        {
          provide: RepositoriesApi,
          useValue: { repositoryDetails: details, repositoryCredentials: () => of({ protocol: 'https', inUse: null }) }
        },
        { provide: PushChannelService, useValue: push }
      ]
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settle();
  }

  beforeEach(() => {
    requested = [];
    push = { events: new Subject(), reconnected: new Subject() };
  });

  it('shows the name, remote, status and warnings', async () => {
    await open('/repositories/7/settings', of(repositoryDetails({ warnings: [ 'key-locked' ] })));

    expect(requested).toEqual([ 7 ]);
    expect(page().querySelector('.name')?.textContent?.trim()).toBe('handbook');
    expect(page().querySelector('.remote')?.textContent?.trim()).toBe('github.com/acme/handbook');
    expect(status()?.hasAttribute('showready')).toBe(true);
    expect(status()?.textContent).toContain('web-shell.RepositoryStatusComponent.warning.key-locked');
    expect(page().querySelector('repo-clone-details')).not.toBeNull();
  });

  it('shows "Repositories › handbook › Settings", with links to the list and the repository', async () => {
    await open('/repositories/7/settings', of(repositoryDetails()));

    expect(crumbs()).toEqual([ `${KEY}.repositories`, 'handbook' ]);
    expect(heading()?.textContent?.trim()).toBe(`${KEY}.heading`);
    expect(crumbLinks().map(link => link.getAttribute('href'))).toEqual([ '/repositories', '/repositories/7' ]);
  });

  it('links the name to this page while the repository cannot be opened', async () => {
    await open(
      '/repositories/7/settings',
      of(repositoryDetails({ status: 'error', error: 'clone-failed' }))
    );

    expect(crumbLinks()[1].getAttribute('href')).toBe('/repositories/7/settings');
  });

  it('offers Open only when openable', async () => {
    await open('/repositories/7/settings', of(repositoryDetails()));
    expect(openLink()?.getAttribute('href')).toBe('/repositories/7');
    expect(openLink()?.getAttribute('aria-label')).toBe(`${KEY}.openLabel`);

    TestBed.resetTestingModule();
    await open('/repositories/7/settings', of(repositoryDetails({ status: 'cloning' })));
    expect(openLink()).toBeNull();
  });

  it('shows Page not found for a repository that does not exist', async () => {
    await open(
      '/repositories/7/settings',
      throwError(() => apiFailure(404, 'not-found'))
    );

    expect(page().querySelector('shell-page-not-found')).not.toBeNull();
    expect(page().querySelector('ui-page')).toBeNull();
    expect(TestBed.inject(Title).getTitle()).toBe('Page not found · Front Burner');
  });

  it('publishes a title to announce when the repository could not be loaded', async () => {
    const published: string[] = [];
    const failed = new Subject<RepositoryDetails>();
    await open('/repositories/7/settings', failed);
    TestBed.inject(PageTitleService).changes.subscribe(title => published.push(title));

    failed.error(apiFailure(500, 'internal'));
    await settle();

    expect(published).toEqual([ 'Front Burner' ]);
  });

  it('offers Try again when the repository could not be loaded', async () => {
    await open(
      '/repositories/7/settings',
      throwError(() => apiFailure(500, 'internal')),
      of(repositoryDetails())
    );
    const retry = [ ...page().querySelectorAll('button') ].find(button =>
      button.textContent?.trim() === `${KEY}.retry`
    );
    expect(page().textContent).toContain(`${KEY}.loadFailed`);

    retry?.click();
    await settle();

    expect(page().querySelector('.name')?.textContent?.trim()).toBe('handbook');
  });

  it('follows the status without a reload', async () => {
    await open(
      '/repositories/7/settings',
      of(repositoryDetails({ status: 'cloning' })),
      of(repositoryDetails())
    );
    expect(openLink()).toBeNull();

    push.events.next({ type: 'repository.status', repositoryId: 7, status: 'ready', error: null });
    await settle();

    expect(openLink()).not.toBeNull();
  });

  it('shows the error of a clone that fails while open', async () => {
    await open(
      '/repositories/7/settings',
      of(repositoryDetails({ status: 'cloning', clone: { jobId: 3, state: 'running', percent: 10 } })),
      of(repositoryDetails(
        { status: 'error', error: 'clone-failed' },
        { errorDetail: 'fatal: repository not found', errorRequestId: 'req-1' }
      ))
    );
    expect(page().querySelector('repo-clone-status ui-progress-bar')).not.toBeNull();

    push.events.next({ type: 'job.progress', jobId: 3, percent: 55 });
    await settle();
    expect(page().querySelector('repo-clone-status ui-progress-bar')?.getAttribute('aria-valuenow')).toBe('55');

    push.events.next({ type: 'repository.status', repositoryId: 7, status: 'error', error: 'clone-failed' });
    await settle();

    const status = page().querySelector('repo-clone-status');
    expect(status?.querySelector('ui-progress-bar')).toBeNull();
    expect(status?.textContent).toContain('web-shell.RepositoryStatusDetailComponent.error.clone-failed');
    expect(status?.querySelector('pre.message')?.textContent).toBe('fatal: repository not found');
    expect(status?.querySelector('.request code')?.textContent).toBe('req-1');
  });

  it('reloads after a reconnect', async () => {
    await open(
      '/repositories/7/settings',
      of(repositoryDetails()),
      of(repositoryDetails({ warnings: [ 'credentials-refused' ] }))
    );

    push.reconnected.next();
    await settle();

    expect(requested).toEqual([ 7, 7 ]);
    expect(status()?.textContent).toContain('web-shell.RepositoryStatusComponent.warning.credentials-refused');
  });

  it('moves focus to the heading', async () => {
    await open('/repositories/7/settings');

    // While it loads, the page already has its heading, focusable for the focus after navigation (NV-18).
    const headings = page().querySelectorAll('h1');
    expect(headings.length).toBe(1);
    expect(headings[0].getAttribute('tabindex')).toBe('-1');
  });

  it('moves focus to the heading of Page not found when the repository is missing', async () => {
    const missing = new Subject<RepositoryDetails>();
    await open('/repositories/7/settings', missing);
    heading()?.focus();

    missing.error(apiFailure(404, 'not-found'));
    await settle();

    expect(document.activeElement).toBe(page().querySelector('shell-page-not-found h1'));
  });

  it('has the tab title', async () => {
    await open('/repositories/7/settings', of(repositoryDetails()));

    expect(TestBed.inject(Title).getTitle()).toBe('Settings · handbook · Front Burner');
  });
});
