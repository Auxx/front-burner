import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CurrentUser } from '@front-burner/shared-contracts';
import { AuthSessionService } from '@front-burner/web-core';

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
          'web-shell.UserMenuComponent.logout': 'Log out'
        })
      ],
      providers: [ { provide: AuthSessionService, useValue: { logout } } ]
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

  it('logs out', async () => {
    trigger().click();
    await settle(fixture);
    menuItem('Log out')?.click();
    await settle(fixture);

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
