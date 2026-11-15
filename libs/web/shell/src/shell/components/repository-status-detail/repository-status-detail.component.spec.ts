import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { RepositorySummary } from '@front-burner/shared-contracts';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RepositoryStatusDetailComponent } from './repository-status-detail.component';

const KEY = 'web-shell.RepositoryStatusDetailComponent';

const ready: RepositorySummary = {
  id: 7,
  name: 'handbook',
  remote: 'github.com/acme/handbook',
  status: 'ready',
  error: null,
  warnings: [],
  clone: null,
  lastAccessedAt: '2026-10-26T10:00:00.000Z'
};

describe('RepositoryStatusDetailComponent', () => {
  let fixture: ComponentFixture<RepositoryStatusDetailComponent>;

  const host = () => fixture.nativeElement as HTMLElement;
  const bar = () => host().querySelector('ui-progress-bar');

  async function render(repository: RepositorySummary): Promise<void> {
    await TestBed.configureTestingModule({ imports: [ RepositoryStatusDetailComponent, translocoTesting() ] })
      .compileComponents();
    fixture = TestBed.createComponent(RepositoryStatusDetailComponent);
    fixture.componentRef.setInput('repository', repository);
    await settle(fixture);
  }

  it('shows nothing for a ready repository', async () => {
    await render(ready);

    expect(host().textContent?.trim()).toBe('');
    expect(bar()).toBeNull();
  });

  it('shows what went wrong for a repository in error (DS-22, RM-6)', async () => {
    await render({ ...ready, status: 'error', error: 'working-copy-missing' });

    expect(host().querySelector('.error')?.textContent?.trim()).toBe(`${KEY}.error.working-copy-missing`);
  });

  it('says that a clone waits its turn (RM-7, AR-52)', async () => {
    await render({ ...ready, status: 'cloning', clone: { jobId: 3, state: 'waiting', percent: null } });

    expect(host().textContent?.trim()).toBe(`${KEY}.waiting`);
    expect(bar()).toBeNull();
  });

  it('shows a running clone\'s progress (RM-7, DS-23)', async () => {
    await render({ ...ready, status: 'cloning', clone: { jobId: 3, state: 'running', percent: 42 } });

    expect(bar()?.getAttribute('aria-valuenow')).toBe('42');
    expect(bar()?.getAttribute('aria-label')).toBe(`${KEY}.progress`);
    expect(host().querySelector('.percent')?.textContent?.trim()).toBe(`${KEY}.percent`);
  });

  it('shows an indeterminate bar before the first report', async () => {
    await render({ ...ready, status: 'cloning', clone: { jobId: 3, state: 'running', percent: null } });

    expect(bar()?.hasAttribute('aria-valuenow')).toBe(false);
    expect(host().querySelector('.percent')).toBeNull();
  });

  it('shows an indeterminate bar for a cloning repository whose job is not known', async () => {
    await render({ ...ready, status: 'cloning', clone: null });

    expect(bar()).not.toBeNull();
    expect(bar()?.hasAttribute('aria-valuenow')).toBe(false);
  });
});
