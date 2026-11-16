import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { CurrentUser } from '@front-burner/shared-contracts';
import { APP_VERSION, AuthSessionService } from '@front-burner/web-core';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { UserMenuComponent } from './user-menu.component';

const ada: CurrentUser = {
  id: 1,
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  role: 'administrator',
  allowedGitLevels: [ 'advanced' ]
};

@Component({ imports: [ UserMenuComponent ], template: '<shell-user-menu [user]="user" />' })
class HostComponent {
  readonly user = ada;
}

describe('UserMenuComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let logout: ReturnType<typeof vi.fn>;

  const trigger = () => (fixture.nativeElement as HTMLElement).querySelector('button') as HTMLButtonElement;
  const menuItem = (name: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item =>
      item.textContent?.trim() === name
    );

  beforeEach(async () => {
    logout = vi.fn(() => Promise.resolve());
    await TestBed.configureTestingModule({
      imports: [
        HostComponent,
        translocoTesting({
          'web-shell.UserMenuComponent.label': 'Account menu for {{ name }}',
          'web-shell.UserMenuComponent.preferences': 'Preferences',
          'web-shell.UserMenuComponent.logout': 'Log out',
          'web-shell.UserMenuComponent.version': 'Front Burner {{ version }}'
        })
      ],
      providers: [
        provideRouter([ { path: 'preferences', children: [] } ]),
        { provide: APP_VERSION, useValue: '1.4.2' },
        { provide: AuthSessionService, useValue: { logout } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await settle(fixture);
  });

  it('shows the initials', () => {
    expect(trigger().textContent?.trim()).toBe('AL');
  });

  it('names the menu after the user', () => {
    expect(trigger().getAttribute('aria-label')).toBe('Account menu for Ada Lovelace');
  });

  it('shows the display name and the email', async () => {
    trigger().click();
    await settle(fixture);

    const menu = document.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain('Ada Lovelace');
    expect(menu?.textContent).toContain('ada@example.com');
  });

  it('shows the version in the user menu', async () => {
    trigger().click();
    await settle(fixture);

    // A menu item, so that the arrow keys reach it and a screen reader reads it,
    // which plain text in a menu never is; disabled, as there is nothing to do.
    const version = menuItem('Front Burner 1.4.2') as HTMLButtonElement;
    expect(version.getAttribute('aria-disabled')).toBe('true');
    expect(version.disabled).toBe(false);

    version.click();
    await settle(fixture);
    expect(TestBed.inject(Router).url).toBe('/');
    expect(logout).not.toHaveBeenCalled();
  });

  it('offers Preferences, which leads to /preferences', async () => {
    trigger().click();
    await settle(fixture);

    const items = [ ...document.querySelectorAll('[role="menuitem"]') ].map(item => item.textContent?.trim());
    expect(items).toEqual([ 'Preferences', 'Log out', 'Front Burner 1.4.2' ]);

    menuItem('Preferences')?.click();
    await settle(fixture);

    expect(TestBed.inject(Router).url).toBe('/preferences');
    expect(logout).not.toHaveBeenCalled();
  });

  it('logs out', async () => {
    trigger().click();
    await settle(fixture);
    menuItem('Log out')?.click();
    await settle(fixture);

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
