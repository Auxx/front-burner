import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { GitChange, GitStatus } from '@front-burner/shared-contracts';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { restoreLayout, stubViewportLayout } from '../../../testing/viewport-layout';
import { GitStatusStore } from '../../services/git-status-store/git-status-store.service';
import { ChangesPaneComponent } from './changes-pane.component';

const KEY = 'web-feature-repository-screen.ChangesPaneComponent';

function statusOf(changes: GitChange[]): GitStatus {
  return { branch: 'main', noCommits: false, upstream: null, ahead: 0, behind: 0, changes, mergeInProgress: false };
}

const THREE: GitChange[] = [
  { path: 'README.md', state: 'modified' },
  { path: 'docs/guide.md', state: 'modified' },
  { path: 'logo.png', state: 'deleted' }
];

describe('ChangesPaneComponent', () => {
  let status: ReturnType<typeof signal<GitStatus | null>>;
  let failed: ReturnType<typeof signal<boolean>>;
  let refresh: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<ChangesPaneComponent>;

  const host = () => fixture.nativeElement as HTMLElement;
  const list = () => host().querySelector('[role="list"]');
  const rows = () => [ ...host().querySelectorAll('rs-change-entry') ];
  const names = () => rows().map(row => row.querySelector('.name')?.textContent?.trim());

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(ChangesPaneComponent);
    await settle(fixture);
    await settle(fixture);
  }

  beforeAll(stubViewportLayout);
  afterAll(restoreLayout);

  beforeEach(() => {
    status = signal<GitStatus | null>(statusOf(THREE));
    failed = signal(false);
    refresh = vi.fn(() => Promise.resolve());
    TestBed.configureTestingModule({
      imports: [ ChangesPaneComponent, translocoTesting() ],
      providers: [ { provide: GitStatusStore, useValue: { status, failed, refresh } } ]
    });
  });

  it('lists every change in the order of the status', async () => {
    await render();

    expect(list()?.getAttribute('aria-label')).toBe(`${KEY}.label`);
    expect(names()).toEqual([ 'README.md', 'guide.md', 'logo.png' ]);
    expect(rows().map(row => row.getAttribute('role'))).toEqual([ 'listitem', 'listitem', 'listitem' ]);
    expect(rows().map(row => row.getAttribute('aria-posinset'))).toEqual([ '1', '2', '3' ]);
    expect(rows().map(row => row.getAttribute('aria-setsize'))).toEqual([ '3', '3', '3' ]);
  });

  it('renders only the rows near the view of a very long list', async () => {
    status.set(statusOf(Array.from({ length: 20_000 }, (_, index) => ({
      path: `file-${index}.md`,
      state: 'added' as const
    }))));
    await render();

    expect(rows().length).toBeGreaterThan(0);
    expect(rows().length).toBeLessThan(100);
    expect(rows()[0].getAttribute('aria-setsize')).toBe('20000');
  });

  it('says No changes since the last commit', async () => {
    status.set(statusOf([]));
    await render();

    expect(host().textContent).toContain(`${KEY}.empty`);
    expect(list()).toBeNull();
  });

  it('shows neither a list nor No changes before the first status', async () => {
    status.set(null);
    await render();

    expect(host().querySelector('ui-spinner')).not.toBeNull();
    expect(host().textContent).not.toContain(`${KEY}.empty`);
    expect(list()).toBeNull();
  });

  it('keeps the list and says so when a read failed', async () => {
    failed.set(true);
    await render();

    expect(host().textContent).toContain(`${KEY}.failed`);
    expect(names()).toEqual([ 'README.md', 'guide.md', 'logo.png' ]);
  });

  it('does not say No changes when the first read failed, and tries again', async () => {
    status.set(null);
    failed.set(true);
    await render();

    expect(host().textContent).toContain(`${KEY}.failed`);
    expect(host().textContent).not.toContain(`${KEY}.empty`);
    expect(host().querySelector('ui-spinner')).toBeNull();

    (host().querySelector('ui-inline-banner button') as HTMLButtonElement).click();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('marks the selected path and passes on the one asked for', async () => {
    await render();
    fixture.componentRef.setInput('selected', 'docs/guide.md');
    await settle(fixture);
    const asked: string[] = [];
    fixture.componentInstance.selectPath.subscribe(path => asked.push(path));

    const current = host().querySelector('button[aria-current="true"]') as HTMLButtonElement;
    expect(current.querySelector('.name')?.textContent?.trim()).toBe('guide.md');

    current.click();
    expect(asked).toEqual([ 'docs/guide.md' ]);
  });
});
