import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { RepositorySummary } from '@front-burner/shared-contracts';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { NotOpenableComponent } from './not-openable.component';

const KEY = 'web-feature-repository-screen.NotOpenableComponent';

const handbook: RepositorySummary = {
  id: 12,
  name: 'handbook',
  remote: 'github.com/acme/handbook',
  status: 'cloning',
  error: null,
  warnings: [],
  lastAccessedAt: '2026-10-28T10:00:00.000Z'
};

describe('NotOpenableComponent', () => {
  let fixture: ComponentFixture<NotOpenableComponent>;

  const host = () => fixture.nativeElement as HTMLElement;

  async function show(repository: RepositorySummary): Promise<void> {
    TestBed.configureTestingModule({ imports: [ NotOpenableComponent, translocoTesting() ], providers: [ provideRouter([]) ] });
    fixture = TestBed.createComponent(NotOpenableComponent);
    fixture.componentRef.setInput('repository', repository);
    await settle(fixture);
  }

  it.each([
    [ { status: 'cloning', error: null }, 'cloning' ],
    [ { status: 'error', error: 'clone-failed' }, 'cloneFailed' ],
    [ { status: 'error', error: 'clone-timed-out' }, 'cloneFailed' ],
    [ { status: 'error', error: 'working-copy-missing' }, 'workingCopyMissing' ],
    [ { status: 'needs-confirmation', error: null }, 'needsConfirmation' ]
  ] as const)('explains %j', async (fields, text) => {
    await show({ ...handbook, ...fields });

    expect(host().textContent).toContain(`${KEY}.${text}`);
  });

  it('links to the repository settings', async () => {
    await show(handbook);

    const link = host().querySelector('a') as HTMLAnchorElement;
    expect(link.textContent?.trim()).toBe(`${KEY}.settings`);
    expect(link.getAttribute('href')).toBe('/repositories/12/settings');
  });
});
