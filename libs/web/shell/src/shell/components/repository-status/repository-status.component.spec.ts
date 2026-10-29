import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { RepositorySummary } from '@front-burner/shared-contracts';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RepositoryStatusComponent } from './repository-status.component';

const KEY = 'web-shell.RepositoryStatusComponent';

const ready: RepositorySummary = {
  id: 7,
  name: 'handbook',
  remote: 'github.com/acme/handbook',
  status: 'ready',
  error: null,
  warnings: [],
  lastAccessedAt: '2026-10-26T10:00:00.000Z'
};

describe('RepositoryStatusComponent', () => {
  let fixture: ComponentFixture<RepositoryStatusComponent>;

  const badges = () =>
    [ ...(fixture.nativeElement as HTMLElement).querySelectorAll('[uiBadge]') ].map(badge => ({
      text: badge.textContent?.trim(),
      look: badge.getAttribute('data-status')
    }));

  async function render(repository: RepositorySummary): Promise<void> {
    await TestBed.configureTestingModule({ imports: [ RepositoryStatusComponent, translocoTesting() ] })
      .compileComponents();
    fixture = TestBed.createComponent(RepositoryStatusComponent);
    fixture.componentRef.setInput('repository', repository);
    await settle(fixture);
  }

  it('shows no badge for a ready repository', async () => {
    await render(ready);

    expect(badges()).toEqual([]);
  });

  it('shows the status and each warning', async () => {
    await render({ ...ready, status: 'error', warnings: [ 'credentials-refused', 'key-locked' ] });

    expect(badges()).toEqual([
      { text: `${KEY}.status.error`, look: 'danger' },
      { text: `${KEY}.warning.credentials-refused`, look: 'warning' },
      { text: `${KEY}.warning.key-locked`, look: 'warning' }
    ]);
  });

  it('highlights a repository that needs confirmation', async () => {
    await render({ ...ready, status: 'needs-confirmation' });

    expect(badges()).toEqual([ { text: `${KEY}.status.needs-confirmation`, look: 'info' } ]);
  });

  it('shows a cloning repository as neutral', async () => {
    await render({ ...ready, status: 'cloning' });

    expect(badges()).toEqual([ { text: `${KEY}.status.cloning`, look: 'neutral' } ]);
  });
});
