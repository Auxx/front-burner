import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CurrentUser, RepositorySummary } from '@front-burner/shared-contracts';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { AuthSessionService } from '@front-burner/web-core';
import { of } from 'rxjs';

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

  async function show(inputs: { narrow?: boolean; withFiles?: boolean; } = {}): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ RepositoryBarComponent, translocoTesting() ],
      providers: [
        provideRouter([]),
        { provide: AuthSessionService, useValue: { logout: vi.fn() } },
        { provide: RepositoriesApi, useValue: { recent: () => of({ repositories: [] }) } }
      ]
    });
    fixture = TestBed.createComponent(RepositoryBarComponent);
    fixture.componentRef.setInput('repository', handbook);
    fixture.componentRef.setInput('user', ada);
    fixture.componentRef.setInput('narrow', inputs.narrow ?? false);
    fixture.componentRef.setInput('withFiles', inputs.withFiles ?? true);
    await settle(fixture);
  }

  it('shows the save status after the repository name (NV-9)', async () => {
    await show();
    fixture.componentRef.setInput('saveStatus', { kind: 'saving' });
    await settle(fixture);

    const parts = [ ...bar().querySelectorAll('h1, rs-save-status') ];
    expect(parts.map(part => part.localName)).toEqual([ 'h1', 'rs-save-status' ]);
    expect(bar().querySelector('rs-save-status')?.textContent?.trim()).toBe(
      'web-feature-repository-screen.SaveStatusComponent.saving'
    );
  });

  it('shows no save status for a repository that cannot be opened', async () => {
    await show({ withFiles: false });

    expect(bar().querySelector('rs-save-status')).toBeNull();
  });

  it('shows the bar\'s parts in order', async () => {
    await show();

    const parts = [ ...bar().querySelectorAll('shell-brand-link, h1, shell-user-menu') ];
    expect(parts.map(part => part.localName)).toEqual([ 'shell-brand-link', 'h1', 'shell-user-menu' ]);
    expect(bar().querySelector('h1')?.textContent?.trim()).toBe('handbook');
    expect(bar().querySelector('shell-brand-link a')?.getAttribute('href')).toBe('/');
  });

  it('opens the repository switcher from the name', async () => {
    await show();

    const name = bar().querySelector('h1 button') as HTMLButtonElement;
    expect(name.textContent?.trim()).toBe('handbook');
    expect(name.getAttribute('aria-haspopup')).toBe('menu');

    name.click();
    await settle(fixture);

    expect(name.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.cdk-overlay-container a[href="/repositories/12/settings"]')).not.toBeNull();
  });

  it('makes the brand link compact on narrow screens', async () => {
    await show({ narrow: true });

    expect(bar().querySelector('shell-brand-link a')?.getAttribute('aria-label')).toBe(
      'web-shell.BrandLinkComponent.dashboard'
    );
  });

  it('has no Files button', async () => {
    await show();

    expect(bar().querySelector('button.files')).toBeNull();
    expect(bar().textContent).not.toContain(`${KEY}.files`);
  });
});
