import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CurrentUser, RepositorySummary } from '@front-burner/shared-contracts';
import { AuthSessionService } from '@front-burner/web-core';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RepositoryBarComponent } from './repository-bar.component';

const KEY = 'web-feature-repository-screen.RepositoryBarComponent';

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

describe('RepositoryBarComponent', () => {
  let fixture: ComponentFixture<RepositoryBarComponent>;

  const bar = () => fixture.nativeElement as HTMLElement;
  const files = () => bar().querySelector('button.files') as HTMLButtonElement;

  async function show(inputs: { narrow?: boolean; filesOpen?: boolean; withFiles?: boolean; } = {}): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ RepositoryBarComponent, translocoTesting() ],
      providers: [ provideRouter([]), { provide: AuthSessionService, useValue: { logout: vi.fn() } } ]
    });
    fixture = TestBed.createComponent(RepositoryBarComponent);
    fixture.componentRef.setInput('repository', handbook);
    fixture.componentRef.setInput('user', ada);
    fixture.componentRef.setInput('narrow', inputs.narrow ?? false);
    fixture.componentRef.setInput('filesOpen', inputs.filesOpen ?? true);
    fixture.componentRef.setInput('withFiles', inputs.withFiles ?? true);
    await settle(fixture);
  }

  it('shows the bar\'s parts in order', async () => {
    await show();

    const parts = [ ...bar().querySelectorAll('shell-brand-link, h1, button.files, shell-user-menu') ];
    expect(parts.map(part => part.localName)).toEqual([ 'shell-brand-link', 'h1', 'button', 'shell-user-menu' ]);
    expect(bar().querySelector('h1')?.textContent?.trim()).toBe('handbook');
    expect(bar().querySelector('shell-brand-link a')?.getAttribute('href')).toBe('/');
  });

  it('makes the brand link compact on narrow screens', async () => {
    await show({ narrow: true });

    expect(bar().querySelector('shell-brand-link a')?.getAttribute('aria-label')).toBe(
      'web-shell.BrandLinkComponent.dashboard'
    );
  });

  it('toggles the file tree and says whether it is shown', async () => {
    await show({ filesOpen: false });
    const toggled = vi.fn();
    fixture.componentInstance.toggleFiles.subscribe(toggled);

    expect(files().textContent?.trim()).toBe(`${KEY}.files`);
    expect(files().getAttribute('aria-expanded')).toBe('false');

    files().click();
    expect(toggled).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('filesOpen', true);
    await settle(fixture);
    expect(files().getAttribute('aria-expanded')).toBe('true');
  });

  it('has no Files button without a file tree', async () => {
    await show({ withFiles: false });

    expect(files()).toBeNull();
    expect(bar().querySelector('h1')?.textContent?.trim()).toBe('handbook');
  });
});
