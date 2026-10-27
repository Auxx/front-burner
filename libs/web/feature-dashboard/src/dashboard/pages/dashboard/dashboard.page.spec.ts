import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CurrentUser, RecentRepositories, RepositorySummary } from '@front-burner/shared-contracts';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { NEVER, Observable, of, throwError } from 'rxjs';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { DashboardHintService } from '../../services/dashboard-hint/dashboard-hint.service';
import { DashboardPage } from './dashboard.page';

const KEY = 'web-feature-dashboard.DashboardPage';

const user: CurrentUser = { id: 4, email: 'ada@example.com', displayName: 'Ada', role: 'user' };

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

  const page = () => fixture.nativeElement as HTMLElement;
  const guide = () => page().querySelector('dash-add-repository-guide');
  const recent = () => page().querySelector('dash-recent-repositories');
  const retry = () =>
    [ ...page().querySelectorAll('button') ].find(button => button.textContent?.trim() === `${KEY}.retry`);

  async function open(...answers: Observable<RecentRepositories>[]): Promise<void> {
    responses = answers;
    await TestBed.configureTestingModule({
      imports: [ DashboardPage, translocoTesting() ],
      providers: [
        provideRouter([]),
        { provide: RepositoriesApi, useValue: { recent: () => responses.shift() ?? NEVER } },
        { provide: CurrentUserService, useValue: { user: signal(user), load: () => Promise.resolve(user) } },
        { provide: DashboardHintService, useValue: hint }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardPage);
    await settle(fixture);
  }

  beforeEach(() => {
    hint = { hadRepositories: vi.fn(() => false), remember: vi.fn() };
  });

  it('has one h1, "Dashboard", that takes the focus after navigation', async () => {
    await open(of({ repositories: [] }));

    expect(page().querySelectorAll('h1')).toHaveLength(1);
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(`${KEY}.heading`);
    expect(page().querySelector('h1')?.getAttribute('tabindex')).toBe('-1');
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
});
