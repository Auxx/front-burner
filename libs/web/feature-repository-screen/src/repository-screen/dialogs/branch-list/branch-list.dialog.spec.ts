import { TestBed } from '@angular/core/testing';
import type { GitBranchList } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { firstValueFrom, type Observable, of, Subject, throwError } from 'rxjs';

import { apiError, dialogButton, overlay, settleDialog, type } from '../../../testing/dialog-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { type BranchChoice, type BranchListData, BranchListDialog } from './branch-list.dialog';

const K = 'web-feature-repository-screen.BranchListDialog';

const branches: GitBranchList = {
  current: 'main',
  local: [
    { name: 'Docs', upstream: null },
    { name: 'main', upstream: 'origin/main' }
  ],
  remote: [ { name: 'origin/feature', branch: 'feature' } ],
  singleBranch: false
};

/** `count` local branches: `branch-0000`, and so on. */
function many(count: number): GitBranchList {
  const local = Array.from({ length: count }, (_, index) => ({
    name: `branch-${String(index).padStart(4, '0')}`,
    upstream: null
  }));
  return { current: null, local, remote: [], singleBranch: false };
}

describe('BranchListDialog', () => {
  let gitBranches: ReturnType<typeof vi.fn<(id: number) => Observable<GitBranchList>>>;

  /** Opens the list and waits for it to render; `closed` settles when it closes. */
  async function open(data: Partial<BranchListData> = {}): Promise<{ closed: Promise<BranchChoice | undefined>; }> {
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          'errors.internal': 'Something went wrong.',
          [`${K}.filterMore`]: 'Filter to find the other {{ hidden }}'
        })
      ],
      providers: [ { provide: GitApi, useValue: { gitBranches } } ]
    });
    const ref = TestBed.inject(DialogService).open<BranchListDialog, BranchListData, BranchChoice>(BranchListDialog, {
      data: { repositoryId: 12, ...data }
    });
    const closed = firstValueFrom(ref.closed, { defaultValue: undefined });
    await settleDialog();
    return { closed };
  }

  const filter = () => overlay().querySelector('input') as HTMLInputElement;
  const rows = () => [ ...overlay().querySelectorAll<HTMLButtonElement>('li button') ];
  const names = () => rows().map(row => row.querySelector('.name')?.textContent?.trim());
  const row = (name: string) => rows().find(button => button.querySelector('.name')?.textContent?.trim() === name);
  const text = () => overlay().textContent ?? '';

  async function typeFilter(value: string): Promise<void> {
    type(filter(), value);
    await settleDialog();
  }

  beforeEach(() => {
    gitBranches = vi.fn(() => of(branches));
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('lists local branches with the current one marked, then remote ones', async () => {
    await open();

    expect(gitBranches).toHaveBeenCalledExactlyOnceWith(12);
    expect(names()).toEqual([ 'Docs', 'main', 'origin/feature' ]);
    const groups = [ ...overlay().querySelectorAll('h3') ].map(heading => heading.textContent?.trim());
    expect(groups).toEqual([ `${K}.local`, `${K}.remote` ]);

    // In words as well as with an icon (NF-13.7).
    const current = row('main') as HTMLButtonElement;
    expect(current.textContent).toContain(`${K}.current`);
    expect(current.querySelector('ui-icon')).not.toBeNull();
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(row('Docs')?.textContent).not.toContain(`${K}.current`);
    expect(row('Docs')?.getAttribute('aria-current')).toBeNull();
  });

  it('marks no branch on a detached HEAD', async () => {
    gitBranches = vi.fn(() => of({ ...branches, current: null }));
    await open();

    expect(names()).toEqual([ 'Docs', 'main', 'origin/feature' ]);
    expect(text()).not.toContain(`${K}.current`);
  });

  it('shows that it is loading until the list has been read', async () => {
    const answer = new Subject<GitBranchList>();
    gitBranches = vi.fn(() => answer);
    await open();

    expect(overlay().querySelector('ui-spinner')).not.toBeNull();
    expect(rows()).toEqual([]);

    answer.next(branches);
    answer.complete();
    await settleDialog();

    expect(overlay().querySelector('ui-spinner')).toBeNull();
    expect(rows()).toHaveLength(3);
  });

  it('filters by name, ignoring case', async () => {
    await open();

    await typeFilter('DOC');
    expect(names()).toEqual([ 'Docs' ]);

    await typeFilter('Feat');
    expect(names()).toEqual([ 'origin/feature' ]);

    await typeFilter(' main ');
    expect(names()).toEqual([ 'main' ]);

    await typeFilter('');
    expect(names()).toEqual([ 'Docs', 'main', 'origin/feature' ]);
  });

  it('leaves out the heading of a group that nothing matches', async () => {
    await open();

    await typeFilter('feature');

    const groups = [ ...overlay().querySelectorAll('h3') ].map(heading => heading.textContent?.trim());
    expect(groups).toEqual([ `${K}.remote` ]);
  });

  it('says when nothing matches', async () => {
    await open();
    expect(text()).not.toContain(`${K}.noMatches`);

    await typeFilter('nothing like this');

    expect(rows()).toEqual([]);
    expect(overlay().querySelector('[role="status"]')?.textContent).toContain(`${K}.noMatches`);
    expect(overlay().querySelector('h3')).toBeNull();
  });

  it('says why the list cannot be read', async () => {
    gitBranches = vi.fn()
      .mockReturnValueOnce(throwError(() => apiError(500, 'internal')))
      .mockReturnValue(of(branches));
    await open();

    expect(text()).toContain('Something went wrong.');
    expect(text()).toContain('abcdef01');
    expect(rows()).toEqual([]);
    expect(text()).not.toContain(`${K}.noMatches`);

    dialogButton(`${K}.retry`)?.click();
    await settleDialog();

    expect(gitBranches).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain('Something went wrong.');
    expect(rows()).toHaveLength(3);
    // **Try again** went away with the focus on it.
    expect(document.activeElement).toBe(filter());
  });

  it('says why again when Try again fails too', async () => {
    gitBranches = vi.fn(() => throwError(() => apiError(500, 'internal')));
    await open();

    dialogButton(`${K}.retry`)?.click();
    await settleDialog();

    expect(text()).toContain('Something went wrong.');
    expect(dialogButton(`${K}.retry`)).toBeDefined();
  });

  it('shows the first 200 of 5,000 branches, and says to filter', async () => {
    gitBranches = vi.fn(() => of(many(5000)));
    await open();

    expect(rows()).toHaveLength(200);
    expect(names().at(-1)).toBe('branch-0199');
    expect(text()).toContain('Filter to find the other 4800');

    // What the filter finds counts, not what was shown before it.
    await typeFilter('branch-4999');
    expect(names()).toEqual([ 'branch-4999' ]);
    expect(text()).not.toContain('Filter to find');
  });

  it('counts remote branches towards the first 200', async () => {
    const { local } = many(150);
    const remote = Array.from({ length: 100 }, (_, index) => ({
      name: `origin/remote-${String(index).padStart(2, '0')}`,
      branch: `remote-${String(index).padStart(2, '0')}`
    }));
    gitBranches = vi.fn(() => of({ current: null, local, remote, singleBranch: false }));
    await open();

    expect(rows()).toHaveLength(200);
    expect(names().at(-1)).toBe('origin/remote-49');
    expect(text()).toContain('Filter to find the other 50');
  });

  it('keeps the current branch in the first 200, in its place by name', async () => {
    gitBranches = vi.fn(() => of({ ...many(5000), current: 'branch-4000' }));
    await open();

    expect(rows()).toHaveLength(200);
    expect(names().at(0)).toBe('branch-0000');
    expect(names().at(-1)).toBe('branch-4000');
    expect(row('branch-4000')?.getAttribute('aria-current')).toBe('true');
    expect(text()).toContain('Filter to find the other 4800');
  });

  it('leaves the current branch out when the filter does not match it', async () => {
    gitBranches = vi.fn(() => of({ ...many(5000), current: 'branch-4000' }));
    await open();

    await typeFilter('branch-49');

    expect(names()).not.toContain('branch-4000');
  });

  it('leaves room for remote branches among the first 200', async () => {
    const { local } = many(300);
    const remote = Array.from({ length: 100 }, (_, index) => ({
      name: `origin/remote-${String(index).padStart(2, '0')}`,
      branch: `remote-${String(index).padStart(2, '0')}`
    }));
    gitBranches = vi.fn(() => of({ current: null, local, remote, singleBranch: false }));
    await open();

    expect(rows()).toHaveLength(200);
    expect(names().filter(name => name?.startsWith('origin/'))).toHaveLength(50);
    expect(text()).toContain('Filter to find the other 200');
  });

  it('gives the rows that local branches leave to remote ones', async () => {
    const { local } = many(10);
    const remote = Array.from({ length: 300 }, (_, index) => ({
      name: `origin/remote-${String(index).padStart(3, '0')}`,
      branch: `remote-${String(index).padStart(3, '0')}`
    }));
    gitBranches = vi.fn(() => of({ current: null, local, remote, singleBranch: false }));
    await open();

    expect(rows()).toHaveLength(200);
    expect(names().filter(name => name?.startsWith('origin/'))).toHaveLength(190);
    expect(text()).toContain('Filter to find the other 110');
  });

  it('says when there are no branches at all, which no filter explains', async () => {
    gitBranches = vi.fn(() => of({ current: null, local: [], remote: [], singleBranch: false }));
    await open();

    const status = overlay().querySelector('[role="status"]');
    expect(status?.textContent).toContain(`${K}.noBranches`);
    expect(status?.textContent).not.toContain(`${K}.noMatches`);
  });

  it('has its status region before the list arrives, so that what it then says is announced', async () => {
    const answer = new Subject<GitBranchList>();
    gitBranches = vi.fn(() => answer);
    await open();
    const status = overlay().querySelector('[role="status"]');
    expect(status).not.toBeNull();

    await typeFilter('nothing like this');
    answer.next(branches);
    answer.complete();
    await settleDialog();

    expect(overlay().querySelector('[role="status"]')).toBe(status);
    expect(status?.textContent).toContain(`${K}.noMatches`);
  });

  it('keeps its status region when the read fails', async () => {
    gitBranches = vi.fn(() => throwError(() => apiError(500, 'internal')));
    await open();

    expect(overlay().querySelector('[role="status"]')).not.toBeNull();
  });

  it('stops reading when it closes', async () => {
    const answer = new Subject<GitBranchList>();
    gitBranches = vi.fn(() => answer);
    const { closed } = await open();
    expect(answer.observed).toBe(true);

    TestBed.inject(DialogService).closeAll();
    await closed;
    await settleDialog();

    expect(answer.observed).toBe(false);
  });

  it('shows exactly 200 branches without saying to filter', async () => {
    gitBranches = vi.fn(() => of(many(200)));
    await open();

    expect(rows()).toHaveLength(200);
    expect(text()).not.toContain('Filter to find');
  });

  // Only the end-to-end test has a layout, and checks the width on a phone.
  it('shows a long name in full', async () => {
    const name = `notes/${'a-long-branch-name-'.repeat(11)}`.slice(0, 200);
    gitBranches = vi.fn(() => of({ ...branches, current: name, local: [ { name, upstream: null } ] }));
    await open();

    expect(names()).toContain(name);
  });

  it('shows the note in a single-branch clone', async () => {
    gitBranches = vi.fn(() => of({ ...branches, singleBranch: true }));
    await open();

    expect(text()).toContain(`${K}.singleBranch`);
  });

  it('shows no note in a full clone', async () => {
    await open();

    expect(text()).not.toContain(`${K}.singleBranch`);
  });

  it('moves focus to the filter, and works with the keyboard alone', async () => {
    const { closed } = await open();

    expect(document.activeElement).toBe(filter());
    // Native buttons: Tab reaches them, and Enter and Space press them.
    expect(rows().every(button => button.tagName === 'BUTTON' && button.tabIndex === 0)).toBe(true);

    filter().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(await closed).toBeUndefined();
  });

  it('closes with the local branch that was chosen', async () => {
    const { closed } = await open();

    row('Docs')?.click();

    expect(await closed).toEqual({ kind: 'local', name: 'Docs' });
  });

  it('closes with the remote branch that was chosen, without origin/', async () => {
    const { closed } = await open();

    row('origin/feature')?.click();

    expect(await closed).toEqual({ kind: 'remote', name: 'feature' });
  });

  it('closes with nothing from its close button', async () => {
    const { closed } = await open();

    overlay().querySelector<HTMLButtonElement>('.header button')?.click();

    expect(await closed).toBeUndefined();
  });

  it('closes with kind: new when New branch is chosen', async () => {
    const { closed } = await open();

    dialogButton(`${K}.newBranch`)?.click();

    expect(await closed).toEqual({ kind: 'new' });
  });

  it('disables New branch button when repository has no commits', async () => {
    gitBranches = vi.fn(() => of({ current: 'main', local: [], remote: [], singleBranch: false }));
    await open({ noCommits: true });

    const newBtn = dialogButton(`${K}.newBranch`) as HTMLButtonElement;
    expect(newBtn.getAttribute('aria-disabled')).toBe('true');
    expect(newBtn.getAttribute('aria-describedby')).not.toBeNull();

    newBtn.click();
    await settleDialog();

    expect(overlay().querySelector('rs-branch-list')).not.toBeNull();
  });

  it('offers Undo merge while the merge can be undone, and closes with it', async () => {
    const { closed } = await open({ undoableMerge: true });

    dialogButton(`${K}.undoMerge`)?.click();

    expect(await closed).toEqual({ kind: 'undo-merge' });
  });

  it('does not offer Undo merge otherwise', async () => {
    await open();

    expect(dialogButton(`${K}.undoMerge`)).toBeUndefined();
  });

  it('keeps New branch button available on a detached HEAD', async () => {
    gitBranches = vi.fn(() => of({ current: null, local: [], remote: [], singleBranch: false }));
    const { closed } = await open({ noCommits: false });

    const newBtn = dialogButton(`${K}.newBranch`) as HTMLButtonElement;
    expect(newBtn.getAttribute('aria-disabled')).toBeNull();

    newBtn.click();
    await settleDialog();

    expect(await closed).toEqual({ kind: 'new' });
  });
});
