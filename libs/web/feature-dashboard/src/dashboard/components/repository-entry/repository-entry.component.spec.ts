import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { RepositorySummary } from '@front-burner/shared-contracts';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RepositoryEntryComponent } from './repository-entry.component';

const KEY = 'web-feature-dashboard.RepositoryEntryComponent';
const STATUS = 'web-shell.RepositoryStatusComponent';

const ready: RepositorySummary = {
  id: 7,
  name: 'handbook',
  remote: 'github.com/acme/handbook',
  status: 'ready',
  error: null,
  warnings: [],
  lastAccessedAt: '2026-10-26T10:00:00.000Z'
};

describe('RepositoryEntryComponent', () => {
  let fixture: ComponentFixture<RepositoryEntryComponent>;

  const host = () => fixture.nativeElement as HTMLElement;
  const links = () => [ ...host().querySelectorAll('a') ].map(link => link.getAttribute('href'));
  const badges = () => [ ...host().querySelectorAll('[uiBadge]') ].map(badge => badge.textContent?.trim());

  async function render(repository: RepositorySummary): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ RepositoryEntryComponent, translocoTesting() ],
      providers: [ provideRouter([]) ]
    }).compileComponents();
    fixture = TestBed.createComponent(RepositoryEntryComponent);
    fixture.componentRef.setInput('repository', repository);
    await settle(fixture);
  }

  it('shows the name, the remote and the last access time', async () => {
    await render(ready);

    expect(host().textContent).toContain('handbook');
    expect(host().textContent).toContain('github.com/acme/handbook');
    expect(host().textContent).toContain(`${KEY}.lastAccessed`);
    expect(host().querySelector('time')?.getAttribute('datetime')).toBe(ready.lastAccessedAt);
    expect(host().querySelector('time')?.textContent?.trim()).toMatch(/ago$|^yesterday$/);
  });

  it('links a ready repository to the editor', async () => {
    await render(ready);

    const link = host().querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/repositories/7');
    expect(link.textContent?.trim()).toBe('handbook');
    expect(links()).toEqual([ '/repositories/7' ]);
    expect(badges()).toEqual([]);
  });

  it('does not link a cloning repository to the editor and offers its settings', async () => {
    await render({ ...ready, status: 'cloning' });

    expect(links()).toEqual([ '/repositories/7/settings' ]);
    expect(badges()).toEqual([ `${STATUS}.status.cloning` ]);
  });

  it('shows the error label', async () => {
    await render({ ...ready, status: 'error', error: 'clone-timed-out' });

    expect(links()).toEqual([ '/repositories/7/settings' ]);
    expect(badges()).toEqual([ `${STATUS}.status.error` ]);
    expect(host().textContent).toContain(`${KEY}.error.clone-timed-out`);
  });

  it('shows warnings and keeps the repository openable', async () => {
    await render({ ...ready, warnings: [ 'credentials-refused', 'key-locked' ] });

    expect(links()).toEqual([ '/repositories/7' ]);
    expect(badges()).toEqual([ `${STATUS}.warning.credentials-refused`, `${STATUS}.warning.key-locked` ]);
  });

  it('highlights a repository that needs confirmation', async () => {
    await render({ ...ready, status: 'needs-confirmation' });

    expect(links()).toEqual([]);
    const badge = host().querySelector('[uiBadge]');
    expect(badge?.textContent?.trim()).toBe(`${STATUS}.status.needs-confirmation`);
    expect(badge?.getAttribute('data-status')).toBe('info');
  });

  it('shows the exact time in a tooltip', async () => {
    await render(ready);

    const time = host().querySelector('time') as HTMLElement;
    const exact = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(ready.lastAccessedAt)
    );
    expect(time.getAttribute('tabindex')).toBe('0');
    const description = document.getElementById(time.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe(exact);
  });
});
