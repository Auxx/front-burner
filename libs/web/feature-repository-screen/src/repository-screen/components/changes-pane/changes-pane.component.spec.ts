import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { CurrentUser, GitChange, GitStatus } from '@front-burner/shared-contracts';
import { CurrentUserService } from '@front-burner/web-core';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { restoreLayout, stubViewportLayout } from '../../../testing/viewport-layout';
import { CommitTicksService } from '../../services/commit-ticks/commit-ticks.service';
import { CommitService } from '../../services/commit/commit.service';
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
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [ ChangesPaneComponent, translocoTesting() ],
      providers: [
        CommitTicksService,
        {
          provide: CommitService,
          useValue: {
            paths: signal([]),
            message: signal(''),
            busy: signal(false),
            error: signal(null),
            commit: vi.fn()
          }
        },
        { provide: CurrentUserService, useValue: { user: signal({ id: 4 } as CurrentUser) } },
        { provide: GitStatusStore, useValue: { status, failed, refresh, followed: signal(1) } }
      ]
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

  it('scrolls by the height a row really has', async () => {
    const measured = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ height: 60 } as DOMRect);
    await render();
    await settle(fixture);
    measured.mockRestore();

    expect((host().querySelector('.cdk-virtual-scroll-spacer') as HTMLElement).style.height).toBe('180px');
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

  it('has the commit form below the list and without changes, but not before the first status', async () => {
    await render();
    expect(host().querySelector('[role="list"] ~ rs-commit-form')).not.toBeNull();

    status.set(statusOf([]));
    await settle(fixture);
    expect(host().querySelector('rs-commit-form')).not.toBeNull();

    status.set(null);
    await settle(fixture);
    expect(host().querySelector('rs-commit-form')).toBeNull();
  });

  describe('ticking', () => {
    const all = () => host().querySelector<HTMLInputElement>('.all input');
    const boxes = () => rows().map(row => row.querySelector('input') as HTMLInputElement);

    afterEach(() => localStorage.clear());

    it('has every entry ticked, and the top checkbox with them', async () => {
      await render();

      expect(boxes().map(box => box.checked)).toEqual([ true, true, true ]);
      expect(all()?.checked).toBe(true);
      expect(all()?.getAttribute('aria-checked')).toBeNull();
      expect(boxes()[1].getAttribute('aria-label')).toBe(`web-feature-repository-screen.ChangeEntryComponent.tick`);
    });

    it('shows the top checkbox as mixed when only some are ticked', async () => {
      await render();

      boxes()[1].click();
      await settle(fixture);

      expect(all()?.indeterminate).toBe(true);
      expect(all()?.getAttribute('aria-checked')).toBe('mixed');
      expect(TestBed.inject(CommitTicksService).ticked()).toEqual([ 'README.md', 'logo.png' ]);
    });

    it('clears and ticks all with the top checkbox', async () => {
      await render();

      all()?.click();
      await settle(fixture);
      expect(boxes().map(box => box.checked)).toEqual([ false, false, false ]);
      expect(all()?.checked).toBe(false);
      expect(all()?.indeterminate).toBe(false);

      all()?.click();
      await settle(fixture);
      expect(boxes().map(box => box.checked)).toEqual([ true, true, true ]);
    });
  });

  describe('discarding', () => {
    const discardAll = () => host().querySelector<HTMLButtonElement>('.discard-all');

    it('offers Discard all with the changes the list shows', async () => {
      await render();
      const asked: (readonly GitChange[])[] = [];
      fixture.componentInstance.discard.subscribe(changes => asked.push(changes));

      expect(discardAll()?.textContent?.trim()).toBe(`${KEY}.discardAll`);
      discardAll()?.click();

      expect(asked).toEqual([ THREE ]);
    });

    it('does not offer Discard all without changes', async () => {
      status.set(statusOf([]));
      await render();

      expect(discardAll()).toBeNull();
    });

    it('passes on the Discard of an entry, as a list of one', async () => {
      await render();
      const asked: (readonly GitChange[])[] = [];
      fixture.componentInstance.discard.subscribe(changes => asked.push(changes));

      (rows()[1].querySelector('.discard') as HTMLButtonElement).click();

      expect(asked).toEqual([ [ THREE[1] ] ]);
    });

    it('moves the focus to Discard all after a discard, as the row is gone', async () => {
      await render();
      document.body.append(host());

      fixture.componentInstance.focusAfterDiscard();
      await settle(fixture);

      expect(document.activeElement).toBe(discardAll());
      host().remove();
    });

    it('moves the focus to the pane when no change is left', async () => {
      status.set(statusOf([]));
      await render();
      document.body.append(host());

      fixture.componentInstance.focusAfterDiscard();
      await settle(fixture);

      expect(document.activeElement).toBe(host());
      host().remove();
    });
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
