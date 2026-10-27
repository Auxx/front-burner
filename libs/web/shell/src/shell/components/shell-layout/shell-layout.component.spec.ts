import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CurrentUser } from '@front-burner/shared-contracts';
import { AuthSessionService, CurrentUserService } from '@front-burner/web-core';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { ShellLayoutComponent } from './shell-layout.component';

const ada: CurrentUser = {
  id: 1,
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  role: 'administrator',
  allowedGitLevels: [ 'advanced' ]
};

@Component({ template: '<h1 tabindex="-1">First</h1>' })
class FirstPage {}

@Component({ template: '<h1 tabindex="-1">Second</h1>' })
class SecondPage {}

describe('ShellLayoutComponent', () => {
  let loggedIn: ReturnType<typeof signal<boolean>>;
  let user: ReturnType<typeof signal<CurrentUser | undefined>>;
  let load: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;

  const host = () => harness.fixture.nativeElement as HTMLElement;

  async function open(url: string): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ translocoTesting() ],
      providers: [
        provideRouter([
          {
            path: '',
            component: ShellLayoutComponent,
            children: [ { path: '', component: FirstPage }, { path: 'second', component: SecondPage } ]
          }
        ]),
        { provide: AuthSessionService, useValue: { loggedIn, logout: vi.fn() } },
        { provide: CurrentUserService, useValue: { user, load } }
      ]
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settle(harness.fixture);
  }

  beforeEach(() => {
    loggedIn = signal(true);
    user = signal<CurrentUser | undefined>(ada);
    load = vi.fn(() => Promise.resolve(ada));
  });

  it('has the skip link first', async () => {
    await open('/');

    const first = host().querySelector('a[href], button');
    expect(first?.textContent?.trim()).toBe('web-shell.ShellLayoutComponent.skipToContent');
  });

  it('puts the page in the main landmark', async () => {
    await open('/');

    expect(host().querySelectorAll('main')).toHaveLength(1);
    expect(host().querySelector('main h1')?.textContent).toBe('First');
  });

  it('shows the header only when logged in', async () => {
    await open('/');
    expect(host().querySelector('header shell-app-header')).not.toBeNull();
    expect(load).toHaveBeenCalled();

    loggedIn.set(false);
    user.set(undefined);
    await settle(harness.fixture);
    expect(host().querySelector('shell-app-header')).toBeNull();
  });

  it('tries again to load the user when the backend could not be reached', async () => {
    user.set(undefined);
    load.mockRejectedValueOnce(new Error('offline')).mockImplementation(() => {
      user.set(ada);
      return Promise.resolve(ada);
    });
    vi.useFakeTimers({ toFake: [ 'setTimeout', 'clearTimeout' ] });
    try {
      TestBed.configureTestingModule({
        imports: [ translocoTesting() ],
        providers: [
          provideRouter([ {
            path: '',
            component: ShellLayoutComponent,
            children: [ { path: '', component: FirstPage } ]
          } ]),
          { provide: AuthSessionService, useValue: { loggedIn, logout: vi.fn() } },
          { provide: CurrentUserService, useValue: { user, load } }
        ]
      });
      harness = await RouterTestingHarness.create();
      const navigation = harness.navigateByUrl('/');
      await vi.advanceTimersByTimeAsync(0);
      await navigation;
      expect(load).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5_000);
    } finally {
      vi.useRealTimers();
    }
    await settle(harness.fixture);

    expect(load).toHaveBeenCalledTimes(2);
    expect(host().querySelector('shell-app-header')).not.toBeNull();
  });

  it('does not load the user when logged out', async () => {
    loggedIn.set(false);
    user.set(undefined);
    await open('/');

    expect(load).not.toHaveBeenCalled();
    expect(host().querySelector('shell-app-header')).toBeNull();
  });

  it('focuses the page heading after navigation', async () => {
    await open('/');
    // The first page of a page load leaves the focus at the start, for the skip link.
    expect(document.activeElement).toBe(document.body);

    await TestBed.inject(Router).navigateByUrl('/second');
    await settle(harness.fixture);

    expect(document.activeElement?.textContent).toBe('Second');
  });
});
