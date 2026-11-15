import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { RepositorySummary } from '@front-burner/shared-contracts';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RepositoryListEntryComponent } from './repository-list-entry.component';

const KEY = 'web-feature-repositories.RepositoryListEntryComponent';
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

describe('RepositoryListEntryComponent', () => {
  let fixture: ComponentFixture<RepositoryListEntryComponent>;

  const host = () => fixture.nativeElement as HTMLElement;
  const name = () => host().querySelector('a.name');
  const open = () => host().querySelector('a.open');
  const badges = () => [ ...host().querySelectorAll('[uiBadge]') ].map(badge => badge.textContent?.trim());

  async function render(repository: RepositorySummary): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ RepositoryListEntryComponent, translocoTesting() ],
      providers: [ provideRouter([]) ]
    }).compileComponents();
    fixture = TestBed.createComponent(RepositoryListEntryComponent);
    fixture.componentRef.setInput('repository', repository);
    await settle(fixture);
  }

  it('shows the name, the remote, the last access time and Ready', async () => {
    await render(ready);

    expect(name()?.textContent?.trim()).toBe('handbook');
    expect(host().querySelector('.remote')?.textContent?.trim()).toBe('github.com/acme/handbook');
    expect(host().querySelector('shell-last-accessed')).not.toBeNull();
    expect(badges()).toEqual([ `${STATUS}.status.ready` ]);
  });

  it('links the name to the settings page, and Open to the repository screen', async () => {
    await render(ready);

    expect(name()?.getAttribute('href')).toBe('/repositories/7/settings');
    expect(open()?.getAttribute('href')).toBe('/repositories/7');
    expect(open()?.getAttribute('aria-label')).toBe(`${KEY}.openLabel`);
  });

  it('shows the warnings of an openable repository, with Open', async () => {
    await render({ ...ready, warnings: [ 'credentials-refused' ] });

    expect(badges()).toEqual([ `${STATUS}.status.ready`, `${STATUS}.warning.credentials-refused` ]);
    expect(open()).not.toBeNull();
  });

  it('offers no Open for a cloning repository, whose name still links to its settings', async () => {
    await render({ ...ready, status: 'cloning' });

    expect(badges()).toEqual([ `${STATUS}.status.cloning` ]);
    expect(open()).toBeNull();
    expect(name()?.getAttribute('href')).toBe('/repositories/7/settings');
  });

  it('shows what went wrong for a repository in error, without Open', async () => {
    await render({ ...ready, status: 'error', error: 'clone-timed-out' });

    expect(badges()).toEqual([ `${STATUS}.status.error` ]);
    expect(host().querySelector('.error')?.textContent?.trim()).toBe(`${KEY}.error.clone-timed-out`);
    expect(open()).toBeNull();
  });

  it('offers no Open for a repository that needs confirmation', async () => {
    await render({ ...ready, status: 'needs-confirmation' });

    expect(open()).toBeNull();
  });
});
