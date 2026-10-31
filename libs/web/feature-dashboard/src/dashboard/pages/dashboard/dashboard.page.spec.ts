import { Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { CurrentUser, PushEvent, RecentRepositories, RepositorySummary } from '@front-burner/shared-contracts';
import { ToastService } from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { CurrentUserService, PushChannelService } from '@front-burner/web-core';
import { NEVER, Observable, of, Subject, throwError } from 'rxjs';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { DashboardHintService } from '../../services/dashboard-hint/dashboard-hint.service';
import { DashboardPage } from './dashboard.page';

const KEY = 'web-feature-dashboard.DashboardPage';

const user: CurrentUser = {
  id: 4,
  email: 'ada@example.com',
  displayName: 'Ada',
  role: 'user',
  allowedGitLevels: [ 'advanced' ]
};

const handbook: RepositorySummary = {
  id: 1,
  name: 'handbook',
  remote: 'github.com/acme/handbook',
  status: 'ready',
  error: null,
  warnings: [],
  lastAccessedAt: '2026-10-26T10:00:00.000Z'
};

describe('DashboardPage', () => {
  let fixture: ComponentFixture<DashboardPage>;
  let responses: Observable<RecentRepositories>[];
  let hint: { hadRepositories: ReturnType<typeof vi.fn>; remember: ReturnType<typeof vi.fn>; };
  let push: { events: Subject<PushEvent>; reconnected: Subject<void>; };
  let toast: { show: ReturnType<typeof vi.fn>; };
  let navigationState: Record<string, unknown> | undefined;
  let requests: number;

  const page = () => fixture.nativeElement as HTMLElement;
  const guide = () => page().querySelector('dash-add-repository-guide');
  const recent = () => page().querySelector('dash-recent-repositories');
  const retry = () =>
    [ ...page().querySelectorAll('button') ].find(button => button.textContent?.trim() === `${KEY}.retry`);

  async function open(...answers: Observable<RecentRepositories>[]): Promise<void> {
    await openAs(signal<CurrentUser | undefined>(user), ...answers);
  }

  async function openAs(
    current: ReturnType<typeof signal<CurrentUser | undefined>>,
    ...answers: Observable<RecentRepositories>[]
  ): Promise<void> {
    responses = answers;
    requests = 0;
    const recent = () => {
      requests++;
      return responses.shift() ?? NEVER;
    };
    await TestBed.configureTestingModule({
      imports: [ DashboardPage, translocoTesting() ],
      providers: [
        provideRouter([]),
        { provide: RepositoriesApi, useValue: { recent } },
        { provide: CurrentUserService, useValue: { user: current, load: () => Promise.resolve(user) } },
        { provide: DashboardHintService, useValue: hint },
        { provide: PushChannelService, useValue: push },
        { provide: ToastService, useValue: toast }
      ]
    }).compileComponents();
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'currentNavigation').mockReturnValue(
      navigationState === undefined ? null : { extras: { state: navigationState } } as never
    );
    fixture = TestBed.createComponent(DashboardPage);
    await settle(fixture);
  }

  beforeEach(() => {
    hint = { hadRepositories: vi.fn(() => false), remember: vi.fn() };
    push = { events: new Subject(), reconnected: new Subject() };
    toast = { show: vi.fn() };
    navigationState = undefined;
  });

  it('has one h1, "Dashboard", that takes the focus after navigation', async () => {
    await open(of({ repositories: [] }));

    expect(page().querySelectorAll('h1')).toHaveLength(1);
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(`${KEY}.heading`);
    expect(page().querySelector('h1')?.getAttribute('tabindex')).toBe('-1');
  });

  it('shows the h1 alone in the title bar of one island', async () => {
    await open(of({ repositories: [ handbook ] }));

    const island = page().querySelector('ui-page ui-island') as HTMLElement;
    expect(island.querySelector('h1')).not.toBeNull();
    expect(island.contains(guide())).toBe(true);
    expect(island.contains(recent())).toBe(true);
    expect(page().querySelector('nav')).toBeNull();
  });

  it('is not a main landmark of its own: the shell has it', async () => {
    await open(of({ repositories: [] }));
    expect(page().querySelector('main')).toBeNull();
  });

  it('shows the full guide and no list without repositories', async () => {
    await open(of({ repositories: [] }));

    expect(guide()?.getAttribute('data-form')).toBe('full');
    expect(recent()).toBeNull();
    expect(page().querySelector('ui-spinner')).toBeNull();
    expect(hint.remember).toHaveBeenCalledWith(user.id, false);
  });

  it('shows the compact guide above the list', async () => {
    await open(of({ repositories: [ handbook ] }));

    expect(guide()?.getAttribute('data-form')).toBe('compact');
    expect(recent()).not.toBeNull();
    expect(guide()?.compareDocumentPosition(recent() as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(hint.remember).toHaveBeenCalledWith(user.id, true);
  });

  it('uses the remembered form while loading', async () => {
    hint.hadRepositories.mockReturnValue(true);
    await open(NEVER);

    expect(hint.hadRepositories).toHaveBeenCalledWith(user.id);
    expect(guide()?.getAttribute('data-form')).toBe('compact');
    expect(page().querySelector('ui-spinner')).not.toBeNull();
    expect(recent()).toBeNull();
  });

  it('uses the remembered form while loading, before the user is known', async () => {
    hint.hadRepositories.mockImplementation((userId: number | undefined) => userId === undefined);
    await openAs(signal<CurrentUser | undefined>(undefined), NEVER);

    expect(guide()?.getAttribute('data-form')).toBe('compact');
  });

  it('shows the full guide at once while loading without a hint', async () => {
    await open(NEVER);

    expect(guide()?.getAttribute('data-form')).toBe('full');
    expect(page().querySelector('ui-spinner')).not.toBeNull();
  });

  it('shows the error with Try again', async () => {
    await open(throwError(() => new HttpErrorResponse({ status: 0 })), of({ repositories: [ handbook ] }));

    expect(page().textContent).toContain(`${KEY}.loadFailed`);
    expect(recent()).toBeNull();
    const add = guide()?.querySelector('a[uiButton]');
    expect(add?.getAttribute('href')).toBe('/repositories/new');
    expect(add?.getAttribute('aria-disabled')).toBeNull();
    expect(hint.remember).not.toHaveBeenCalled();

    retry()?.click();
    await settle(fixture);

    expect(page().textContent).not.toContain(`${KEY}.loadFailed`);
    expect(recent()).not.toBeNull();
  });

  describe('after adding a repository', () => {
    const cloning: RepositorySummary = { ...handbook, status: 'cloning' };
    const link = () => page().querySelector<HTMLAnchorElement>('dash-repository-entry a.name');

    async function statusOf(event: Omit<Extract<PushEvent, { type: 'repository.status'; }>, 'type'>): Promise<void> {
      push.events.next({ type: 'repository.status', ...event });
      await settle(fixture);
    }

    it('shows the cloning message after adding', async () => {
      navigationState = { addedRepository: 'handbook' };

      await open(of({ repositories: [ cloning ] }));

      expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ message: `${KEY}.added`, status: 'info' }));
    });

    it('shows no message on an ordinary visit', async () => {
      await open(of({ repositories: [ handbook ] }));

      expect(toast.show).not.toHaveBeenCalled();
    });

    it('makes a cloning repository openable when its clone ends', async () => {
      await open(of({ repositories: [ cloning ] }));
      expect(link()).toBeNull();

      await statusOf({ repositoryId: 1, status: 'ready', error: null });

      expect(link()?.getAttribute('href')).toBe('/repositories/1');
      expect(requests).toBe(1);
    });

    it('shows a clone that failed', async () => {
      await open(of({ repositories: [ cloning ] }));

      await statusOf({ repositoryId: 1, status: 'error', error: 'clone-failed' });

      expect(page().querySelector('dash-repository-entry .error')?.textContent?.trim()).toBe(
        'web-feature-dashboard.RepositoryEntryComponent.error.clone-failed'
      );
    });

    it('reloads the list after a reconnect', async () => {
      await open(of({ repositories: [ cloning ] }), of({ repositories: [ handbook ] }));

      push.reconnected.next();
      await settle(fixture);

      expect(requests).toBe(2);
      expect(link()).not.toBeNull();
    });

    it('reloads the list for an unknown repository', async () => {
      await open(
        of({ repositories: [ handbook ] }),
        of({ repositories: [ { ...handbook, id: 2, name: 'wiki' }, handbook ] })
      );

      await statusOf({ repositoryId: 2, status: 'ready', error: null });

      expect(requests).toBe(2);
      expect(page().querySelectorAll('dash-repository-entry')).toHaveLength(2);
    });

    it('keeps the list when a reload fails', async () => {
      await open(of({ repositories: [ handbook ] }), throwError(() => new HttpErrorResponse({ status: 0 })));

      push.reconnected.next();
      await settle(fixture);

      expect(page().querySelectorAll('dash-repository-entry')).toHaveLength(1);
      expect(page().querySelector('ui-inline-banner')).toBeNull();
    });

    it('stops listening when the page is left', async () => {
      await open(of({ repositories: [ handbook ] }));
      expect(push.events.observed).toBe(true);

      fixture.destroy();

      expect(push.events.observed).toBe(false);
      expect(push.reconnected.observed).toBe(false);
    });

    it('shows the cloning message once: not again on reload or Back', async () => {
      navigationState = { addedRepository: 'handbook' };
      const location = { getState: vi.fn(() => ({ navigationId: 3, addedRepository: 'handbook' })), path: () => '/' };
      const replaceState = vi.fn();
      TestBed.overrideProvider(Location, { useValue: { ...location, replaceState } });

      await open(of({ repositories: [ cloning ] }));

      expect(toast.show).toHaveBeenCalledTimes(1);
      expect(replaceState).toHaveBeenCalledWith('/', '', { navigationId: 3 });
    });

    it('keeps the newest list when answers arrive out of order', async () => {
      const first = new Subject<RecentRepositories>();
      const second = new Subject<RecentRepositories>();
      await open(first, second);

      push.reconnected.next();
      second.next({ repositories: [ handbook ] });
      second.complete();
      first.next({ repositories: [ cloning ] });
      first.complete();
      await settle(fixture);

      expect(link()).not.toBeNull();
    });

    it('applies a status event that arrives while the list loads', async () => {
      const first = new Subject<RecentRepositories>();
      await open(first, of({ repositories: [ handbook ] }));

      await statusOf({ repositoryId: 1, status: 'ready', error: null });
      first.next({ repositories: [ cloning ] });
      first.complete();
      await settle(fixture);

      expect(requests).toBe(2);
      expect(link()).not.toBeNull();
    });
  });
});
