import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CurrentUser } from '@front-burner/shared-contracts';
import { AuthSessionService } from '@front-burner/web-core';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { AppHeaderComponent } from './app-header.component';

const KEY = 'web-shell.AppHeaderComponent';
const DASHBOARD = 'web-shell.BrandLinkComponent.dashboard';
const ada: CurrentUser = {
  id: 1,
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  role: 'administrator',
  allowedGitLevels: [ 'advanced' ]
};

@Component({ imports: [ AppHeaderComponent ], template: '<shell-app-header [user]="user" />' })
class HostPage {
  readonly user = ada;
}

describe('AppHeaderComponent', () => {
  let harness: RouterTestingHarness;

  const header = () => harness.routeNativeElement?.querySelector('shell-app-header') as HTMLElement;
  const link = (name: string) =>
    Array.from(header().querySelectorAll('nav a')).find(a => a.textContent?.trim() === name) as HTMLAnchorElement;

  async function open(url: string): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ translocoTesting() ],
      providers: [
        provideRouter([ { path: '', component: HostPage }, { path: 'repositories', component: HostPage } ]),
        { provide: AuthSessionService, useValue: { logout: vi.fn() } }
      ]
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settle(harness.fixture);
  }

  it('links to the dashboard and the repositories', async () => {
    await open('/');

    expect(link(DASHBOARD).getAttribute('href')).toBe('/');
    expect(link(`${KEY}.repositories`).getAttribute('href')).toBe('/repositories');
    expect(header().querySelector('nav ui-icon[name="flame"]')).toBeNull();
  });

  it('marks the current link', async () => {
    await open('/repositories');

    expect(link(`${KEY}.repositories`).getAttribute('aria-current')).toBe('page');
    expect(link(`${KEY}.repositories`).classList).toContain('active');
    expect(link(DASHBOARD).hasAttribute('aria-current')).toBe(false);
    expect(link(DASHBOARD).classList).not.toContain('active');
  });

  it('marks the dashboard only on the dashboard', async () => {
    await open('/');

    expect(link(DASHBOARD).getAttribute('aria-current')).toBe('page');
    expect(link(DASHBOARD).classList).toContain('active');
    expect(link(`${KEY}.repositories`).hasAttribute('aria-current')).toBe(false);
    expect(link(`${KEY}.repositories`).classList).not.toContain('active');
  });

  it('has a Menu button with the same links, for narrow screens', async () => {
    await open('/');

    const menu = header().querySelector('nav button') as HTMLButtonElement;
    expect(menu.textContent).toContain(`${KEY}.menu`);
    menu.click();
    await settle(harness.fixture);

    const opened = document.getElementById(menu.getAttribute('aria-controls') ?? '');
    const items = Array.from(opened?.querySelectorAll('[role="menuitem"]') ?? []);
    expect(items.map(item => [ item.textContent?.trim(), item.getAttribute('href') ])).toEqual([
      [ `${KEY}.dashboard`, '/' ],
      [ `${KEY}.repositories`, '/repositories' ]
    ]);
  });

  it('reserves the bold width of each link\'s label, so that nothing moves when the current page changes', async () => {
    await open('/');

    const labels = [ ...header().querySelectorAll('nav > shell-brand-link a > .label, nav > a > .label') ];
    expect(labels.map(label => [ label.textContent?.trim(), label.getAttribute('data-label') ])).toEqual([
      [ DASHBOARD, DASHBOARD ],
      [ `${KEY}.repositories`, `${KEY}.repositories` ]
    ]);
  });

  it('has the user menu', async () => {
    await open('/');

    expect(header().querySelector('shell-user-menu')).not.toBeNull();
  });
});
