import { BreakpointObserver } from '@angular/cdk/layout';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  CurrentUser,
  FileContent,
  FileState,
  GitBranchList,
  GitStatus,
  GitSwitchRequest,
  SaveFileRequest
} from '@front-burner/shared-contracts';
import { DialogService, ToastService } from '@front-burner/ui';
import { FilesApi, GitApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { apiError, dialogButton, overlay, settleDialog } from '../../../testing/dialog-testing';
import { MemoryDraftStore, provideMemoryDrafts } from '../../../testing/drafts';
import { fileContent } from '../../../testing/open-files';
import { translocoTesting } from '../../../testing/transloco-testing';
import { DiskChangesService } from '../disk-changes/disk-changes.service';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { MergeActionsService } from '../merge-actions/merge-actions.service';
import { MergeStore } from '../merge-store/merge-store.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';
import { BranchActionsService } from './branch-actions.service';

const K = 'web-feature-repository-screen.BranchActionsService';
const REFUSED = 'web-feature-repository-screen.SwitchRefusedDialog';
const ada = { id: 4 } as CurrentUser;

const BRANCHES: GitBranchList = {
  current: 'main',
  local: [ { name: 'docs', upstream: null }, { name: 'main', upstream: null } ],
  remote: [ { name: 'origin/feature', branch: 'feature' } ],
  singleBranch: false
};

function changed(...paths: string[]): GitStatus {
  return { changes: paths.map(path => ({ path, state: 'modified' })) } as GitStatus;
}

describe('BranchActionsService', () => {
  let service: BranchActionsService;
  let openFiles: OpenFilesService;
  let repository: ReturnType<typeof signal<{ id: number; }>>;
  let status: ReturnType<typeof signal<GitStatus | null>>;
  let statusAfterRefresh: GitStatus | null;
  /** The requests that change something, in order. */
  let requests: string[];
  let switches: GitSwitchRequest[];
  let switchAnswer: () => Observable<void>;
  let saves: { request: SaveFileRequest; answer: Subject<FileState>; }[];
  let toast: { show: ReturnType<typeof vi.fn>; };
  let dismiss: ReturnType<typeof vi.fn>;
  let statusRead: boolean;
  let drafts: MemoryDraftStore;
  let diskChanges: { notice: ReturnType<typeof vi.fn>; settled: ReturnType<typeof vi.fn>; };
  let branches: GitBranchList;
  let branchesAnswer: (() => Observable<GitBranchList>) | null;
  let merging: ReturnType<typeof signal<boolean>>;
  let undo: ReturnType<typeof vi.fn>;
  let undoing: ReturnType<typeof signal<boolean>>;

  const row = (text: string) =>
    [ ...overlay().querySelectorAll<HTMLButtonElement>('rs-branch-list li button') ].find(button =>
      button.textContent?.includes(text)
    );

  /** Opens the list and selects the row that shows `text`. */
  async function choose(text: string): Promise<{ done: Promise<void>; }> {
    const done = service.open();
    await settleDialog();
    row(text)?.click();
    await settleDialog();
    return { done };
  }

  const refused = () => overlay().querySelector('rs-switch-refused');
  const lastToast = () => toast.show.mock.calls.at(-1)?.[0];

  beforeEach(() => {
    repository = signal({ id: 12 });
    status = signal<GitStatus | null>(changed());
    statusAfterRefresh = null;
    requests = [];
    switches = [];
    switchAnswer = () => of(undefined);
    saves = [];
    dismiss = vi.fn();
    toast = { show: vi.fn(() => ({ dismiss })) };
    statusRead = true;
    drafts = new MemoryDraftStore();
    diskChanges = { notice: vi.fn(), settled: vi.fn(() => Promise.resolve()) };
    branches = BRANCHES;
    branchesAnswer = null;
    merging = signal(false);
    undo = vi.fn(() => Promise.resolve());
    undoing = signal(false);
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          'errors.git-busy': 'Git is busy.',
          'errors.internal': 'Something went wrong.',
          'errors.branch-not-found': 'This branch does not exist any more.',
          'errors.file-held': '{{ path }} can not be saved just now.',
          'errors.draft-offered': '{{ path }} has unsaved changes from earlier.',
          [`${K}.file-gone`]: '{{ path }} was deleted elsewhere.',
          'web-feature-repository-screen.FailureToastService.reference': 'Reference: {{ reference }}'
        })
      ],
      providers: [
        BranchActionsService,
        OpenFilesService,
        provideMemoryDrafts(drafts),
        { provide: DiskChangesService, useValue: diskChanges },
        { provide: ToastService, useValue: toast },
        { provide: RepositorySessionService, useValue: { repository } },
        { provide: CurrentUserService, useValue: { user: signal(ada), load: () => Promise.resolve(ada) } },
        { provide: MergeStore, useValue: { merging } },
        { provide: MergeActionsService, useValue: { undo, undoing } },
        {
          provide: GitStatusStore,
          useValue: {
            status,
            readFresh: () => {
              requests.push('status');
              if (statusAfterRefresh !== null) {
                status.set(statusAfterRefresh);
              }
              return Promise.resolve(statusRead);
            }
          }
        },
        {
          provide: GitApi,
          useValue: {
            gitBranches: () => branchesAnswer?.() ?? of(branches),
            createBranch: () => of(undefined),
            switchBranch: (_id: number, request: GitSwitchRequest) => {
              requests.push('switch');
              switches.push(request);
              return switchAnswer();
            }
          }
        },
        {
          provide: FilesApi,
          useValue: {
            readFile: (_id: number, query: { path: string; }): Observable<FileContent> => of(fileContent(query.path)),
            saveFile: (_id: number, request: SaveFileRequest) => {
              requests.push(`save ${request.content}`);
              const answer = new Subject<FileState>();
              saves.push({ request, answer });
              return answer;
            }
          }
        },
        {
          provide: BreakpointObserver,
          useValue: { observe: () => of({ matches: false, breakpoints: {} }), isMatched: () => false }
        }
      ]
    });
    service = TestBed.inject(BranchActionsService);
    openFiles = TestBed.inject(OpenFilesService);
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('switches to a local branch', async () => {
    await (await choose('docs')).done;

    expect(switches).toEqual([ { name: 'docs', remote: false } ]);
    expect(toast.show).not.toHaveBeenCalled();
    expect(refused()).toBeNull();
  });

  it('tracks a remote branch', async () => {
    await (await choose('origin/feature')).done;

    expect(switches).toEqual([ { name: 'feature', remote: true } ]);
  });

  it('opens NewBranchDialog when New branch is chosen', async () => {
    const done = service.open();
    await settleDialog();

    dialogButton('web-feature-repository-screen.BranchListDialog.newBranch')?.click();
    await settleDialog();

    expect(overlay().querySelector('rs-new-branch')).not.toBeNull();

    dialogButton('web-feature-repository-screen.NewBranchDialog.cancel')?.click();
    await settleDialog();
    await done;
  });

  it('leaves the status to the events after a switch', async () => {
    await (await choose('docs')).done;

    expect(requests).toEqual([ 'switch' ]);
  });

  it('says that it is switching until the answer comes, and not during a refusal', async () => {
    const answer = new Subject<void>();
    switchAnswer = () => answer;
    statusAfterRefresh = changed('guide.md');

    const { done } = await choose('docs');
    expect(service.switching()).toBe(true);

    answer.error(apiError(409, 'switch-uncommitted-changes'));
    await settleDialog();

    expect(refused()).not.toBeNull();
    expect(service.switching()).toBe(false);

    dialogButton(`${REFUSED}.close`)?.click();
    await done;
  });

  it('holds an edit made during the switch until the file was compared with the disk', async () => {
    const file = await openFiles.open('guide.md');
    const answer = new Subject<void>();
    switchAnswer = () => answer;
    let compared: () => void = () => undefined;
    diskChanges.settled.mockReturnValue(new Promise<void>(resolve => (compared = resolve)));

    const { done } = await choose('docs');
    file.saver.edit(() => 'typed during the switch');
    expect(file.saver.held()).toBe(true);

    answer.next();
    answer.complete();
    await settleDialog();

    expect(diskChanges.notice).toHaveBeenCalledExactlyOnceWith('guide.md');
    expect(file.saver.held()).toBe(true);
    expect(saves).toEqual([]);

    compared();
    await done;

    expect(file.saver.held()).toBe(false);
  });

  it('also releases the savers when the switch fails', async () => {
    const file = await openFiles.open('guide.md');
    const answer = new Subject<void>();
    switchAnswer = () => answer;

    const { done } = await choose('docs');
    file.saver.edit(() => 'typed during the switch');
    answer.error(apiError(409, 'branch-not-found'));
    await done;

    expect(file.saver.held()).toBe(false);
  });

  it('compares nothing with the disk without an edit', async () => {
    await openFiles.open('guide.md');

    await (await choose('docs')).done;

    expect(diskChanges.notice).not.toHaveBeenCalled();
  });

  it('does not switch while a browser draft is on offer, and says what to do', async () => {
    await drafts.put({ userId: 4, repositoryId: 12, path: 'guide.md' }, {
      content: 'from before',
      savedAt: '2026-10-29T10:05:00.000Z'
    });
    await openFiles.open('guide.md');

    await (await choose('docs')).done;

    expect(switches).toEqual([]);
    expect(lastToast()?.message).toBe('guide.md has unsaved changes from earlier.');
    expect(lastToast()?.actions).toBeUndefined();
  });

  it('does nothing when the list is closed without a choice', async () => {
    const done = service.open();
    await settleDialog();

    TestBed.inject(DialogService).closeAll();
    await done;

    expect(requests).toEqual([]);
  });

  it('does nothing for the current branch', async () => {
    await (await choose('main')).done;

    expect(requests).toEqual([]);
    expect(overlay().querySelector('rs-branch-list')).toBeNull();
  });

  it('opens one list at a time', async () => {
    const gitBranches = vi.spyOn(TestBed.inject(GitApi), 'gitBranches');
    const first = service.open();
    await settleDialog();

    await service.open();

    expect(gitBranches).toHaveBeenCalledTimes(1);
    TestBed.inject(DialogService).closeAll();
    await first;
  });

  it('closes an open list on request, and says whether there was one', async () => {
    expect(service.closeList()).toBe(false);
    const done = service.open();
    await settleDialog();

    expect(service.closeList()).toBe(true);
    await done;

    expect(overlay().querySelector('rs-branch-list')).toBeNull();
    expect(requests).toEqual([]);
  });

  it('closes an open NewBranchDialog on closeList', async () => {
    const done = service.open();
    await settleDialog();

    dialogButton('web-feature-repository-screen.BranchListDialog.newBranch')?.click();
    await settleDialog();

    expect(overlay().querySelector('rs-new-branch')).not.toBeNull();

    expect(service.closeList()).toBe(true);
    await done;

    expect(overlay().querySelector('rs-new-branch')).toBeNull();
  });

  describe('Undo merge', () => {
    const undoButton = () => dialogButton('web-feature-repository-screen.BranchListDialog.undoMerge');

    it('offers Undo merge in the branch list after the notice is dismissed', async () => {
      // The notice is the page's: the list follows the status alone.
      status.set({ ...changed(), undoableMerge: true });
      const done = service.open();
      await settleDialog();

      undoButton()?.click();
      await done;

      expect(undo).toHaveBeenCalledOnce();
      expect(switches).toEqual([]);
    });

    it('does not offer it with uncommitted changes', async () => {
      // The backend says so: `undoableMerge` is false with uncommitted changes (GC-25).
      status.set({ ...changed('guide.md'), undoableMerge: false });
      void service.open();
      await settleDialog();

      expect(overlay().querySelector('rs-branch-list')).not.toBeNull();
      expect(undoButton()).toBeUndefined();
    });

    it('does nothing when the merge can no longer be undone by the time it is chosen', async () => {
      status.set({ ...changed(), undoableMerge: true });
      const done = service.open();
      await settleDialog();

      // Pushed elsewhere while the list was open.
      status.set({ ...changed(), undoableMerge: false });
      undoButton()?.click();
      await done;

      expect(undo).not.toHaveBeenCalled();
    });

    it('does nothing when a merge started by the time it is chosen', async () => {
      status.set({ ...changed(), undoableMerge: true });
      const done = service.open();
      await settleDialog();

      merging.set(true);
      undoButton()?.click();
      await done;

      expect(undo).not.toHaveBeenCalled();
    });

    it('does not open the list while an undo runs', async () => {
      undoing.set(true);

      await service.open();
      await settleDialog();

      expect(overlay()?.querySelector('rs-branch-list') ?? null).toBeNull();
    });
  });

  it('does not open when a merge is in progress', async () => {
    merging.set(true);

    await service.open();
    await settleDialog();

    expect(document.querySelector('rs-branch-list')).toBeNull();
  });

  it('does not open NewBranchDialog when merge starts while branch list is open', async () => {
    const done = service.open();
    await settleDialog();

    merging.set(true);
    dialogButton('web-feature-repository-screen.BranchListDialog.newBranch')?.click();
    await settleDialog();
    await done;

    expect(overlay().querySelector('rs-new-branch')).toBeNull();
  });

  it('sends a waiting save first, and is then refused', async () => {
    const file = await openFiles.open('guide.md');
    file.saver.edit(() => 'mine');
    switchAnswer = () => throwError(() => apiError(409, 'switch-uncommitted-changes'));
    statusAfterRefresh = changed('guide.md');

    const { done } = await choose('docs');

    expect(requests).toEqual([ 'save mine' ]);

    saves[0].answer.next({ hash: 'a'.repeat(64), size: 4 } as FileState);
    saves[0].answer.complete();
    await settleDialog();

    expect(requests).toEqual([ 'save mine', 'switch', 'status' ]);
    expect(refused()?.textContent).toContain('guide.md');

    dialogButton(`${REFUSED}.close`)?.click();
    await done;
  });

  it('does not switch when a save failed', async () => {
    const file = await openFiles.open('guide.md');
    file.saver.edit(() => 'mine');

    const { done } = await choose('docs');
    saves[0].answer.error(apiError(413, 'file-too-large'));
    await done;

    expect(requests).toEqual([ 'save mine' ]);
    expect(lastToast()?.status).toBe('danger');
    expect(lastToast()?.actions).toBeUndefined();
  });

  it('does not switch when a save did not reach the backend, and Try again goes on', async () => {
    const file = await openFiles.open('guide.md');
    file.saver.edit(() => 'mine');

    const { done } = await choose('docs');
    saves[0].answer.error(apiError(503, 'internal'));
    await done;

    expect(switches).toEqual([]);
    expect(lastToast()?.actions).toHaveLength(1);

    lastToast().actions[0].run();
    await settleDialog();
    saves[1].answer.next({ hash: 'a'.repeat(64), size: 4 } as FileState);
    saves[1].answer.complete();
    await settleDialog();

    expect(switches).toEqual([ { name: 'docs', remote: false } ]);
  });

  it('says what to do about a file gone elsewhere, not what only a commit can do', async () => {
    const file = await openFiles.open('guide.md');
    file.saver.edit(() => 'mine');
    openFiles.markGone('guide.md');

    await (await choose('docs')).done;

    expect(switches).toEqual([]);
    expect(lastToast()?.message).toBe('guide.md was deleted elsewhere.');
  });

  it('does not switch after going to another repository', async () => {
    const file = await openFiles.open('guide.md');
    file.saver.edit(() => 'mine');

    const { done } = await choose('docs');
    repository.set({ id: 13 });
    saves[0].answer.error(apiError(413, 'file-too-large'));
    await done;

    expect(switches).toEqual([]);
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('says why with the changed files', async () => {
    switchAnswer = () => throwError(() => apiError(409, 'switch-uncommitted-changes'));
    status.set(changed('old.md'));
    statusAfterRefresh = changed('docs/guide.md', 'README.md');

    const { done } = await choose('docs');

    expect(refused()?.textContent).toContain(`${REFUSED}.message`);
    expect(refused()?.textContent).toContain('docs/guide.md');
    expect(refused()?.textContent).toContain('README.md');
    expect(refused()?.textContent).not.toContain('old.md');
    expect(toast.show).not.toHaveBeenCalled();

    dialogButton(`${REFUSED}.close`)?.click();
    await done;
  });

  it('shows many files in a scrolling list', async () => {
    switchAnswer = () => throwError(() => apiError(409, 'switch-uncommitted-changes'));
    const paths = Array.from({ length: 150 }, (_, index) => `file-${index}.md`);
    statusAfterRefresh = changed(...paths);

    const { done } = await choose('docs');

    const body = refused()?.querySelector('.body');
    expect(body?.querySelectorAll('li')).toHaveLength(150);
    // The footer stays out of what scrolls, so that **Show changes** stays in sight.
    expect(body?.querySelector('[uiDialogFooter]')).toBeNull();
    expect(refused()?.querySelector('[uiDialogFooter]')).not.toBeNull();

    dialogButton(`${REFUSED}.close`)?.click();
    await done;
  });

  it('Show changes opens Changes', async () => {
    switchAnswer = () => throwError(() => apiError(409, 'switch-uncommitted-changes'));
    statusAfterRefresh = changed('guide.md');
    const shown = vi.fn();
    service.showChanges.subscribe(shown);

    const { done } = await choose('docs');
    dialogButton(`${REFUSED}.showChanges`)?.click();
    await done;

    expect(shown).toHaveBeenCalledTimes(1);
    expect(refused()).toBeNull();
  });

  it('closing the refusal does not open Changes', async () => {
    switchAnswer = () => throwError(() => apiError(409, 'switch-uncommitted-changes'));
    const shown = vi.fn();
    service.showChanges.subscribe(shown);

    const { done } = await choose('docs');
    dialogButton(`${REFUSED}.close`)?.click();
    await done;

    expect(shown).not.toHaveBeenCalled();
  });

  it('says why any other failure happened', async () => {
    switchAnswer = () => throwError(() => apiError(409, 'branch-not-found'));

    await (await choose('docs')).done;

    expect(lastToast()?.message).toBe('This branch does not exist any more. Reference: abcdef01');
    expect(lastToast()?.status).toBe('danger');
    expect(lastToast()?.actions).toBeUndefined();
    expect(refused()).toBeNull();
    expect(requests).toEqual([ 'switch' ]);
  });

  it('says so when the changed files could not be read', async () => {
    switchAnswer = () => throwError(() => apiError(409, 'switch-uncommitted-changes'));
    status.set(changed('old.md'));
    statusRead = false;

    const { done } = await choose('docs');

    expect(refused()?.textContent).toContain(`${REFUSED}.listFailed`);
    expect(refused()?.textContent).not.toContain('old.md');

    dialogButton(`${REFUSED}.close`)?.click();
    await done;
  });

  it('shows no refusal after leaving the screen during the switch', async () => {
    const answer = new Subject<void>();
    switchAnswer = () => answer;
    const { done } = await choose('docs');
    requests = [];

    TestBed.resetTestingModule();
    answer.error(apiError(409, 'switch-uncommitted-changes'));
    await done;

    expect(requests).toEqual([]);
    expect(document.querySelector('rs-switch-refused')).toBeNull();
  });

  describe('the toast of a failure', () => {
    beforeEach(() => {
      switchAnswer = () => throwError(() => apiError(500, 'internal'));
    });

    it('goes when another attempt starts', async () => {
      await (await choose('docs')).done;
      expect(dismiss).not.toHaveBeenCalled();

      const done = service.open();
      await settleDialog();

      expect(dismiss).toHaveBeenCalledOnce();
      TestBed.inject(DialogService).closeAll();
      await done;
    });

    it('goes when another repository opens, and not when this one is only read again', async () => {
      await (await choose('docs')).done;

      repository.set({ id: 12 });
      TestBed.tick();
      expect(dismiss).not.toHaveBeenCalled();

      repository.set({ id: 13 });
      TestBed.tick();
      expect(dismiss).toHaveBeenCalledOnce();
    });

    it('goes when the screen is left, and Try again then does nothing', async () => {
      await (await choose('docs')).done;
      const { actions } = lastToast();

      TestBed.resetTestingModule();

      expect(dismiss).toHaveBeenCalledOnce();
      actions[0].run();
      await settleDialog();
      expect(switches).toHaveLength(1);
    });

    it('replaces the one before it', async () => {
      await (await choose('docs')).done;

      expect(lastToast()?.key).toEqual(expect.any(String));
    });
  });

  describe('Try again, when the answer that got lost may have been a success', () => {
    beforeEach(() => {
      switchAnswer = () => throwError(() => apiError(503, 'internal'));
    });

    it('does nothing when already on the branch', async () => {
      await (await choose('docs')).done;
      switches = [];
      branches = { ...BRANCHES, current: 'docs' };

      lastToast().actions[0].run();
      await settleDialog();

      expect(switches).toEqual([]);
      expect(service.switching()).toBe(false);
    });

    it('switches to the local branch that was made, rather than making it again', async () => {
      await (await choose('origin/feature')).done;
      switches = [];
      branches = { ...BRANCHES, local: [ ...BRANCHES.local, { name: 'feature', upstream: 'origin/feature' } ] };
      switchAnswer = () => of(undefined);

      lastToast().actions[0].run();
      await settleDialog();

      expect(switches).toEqual([ { name: 'feature', remote: false } ]);
    });

    it('says why when it can\'t read the branches', async () => {
      await (await choose('docs')).done;
      switches = [];
      branchesAnswer = () => throwError(() => apiError(503, 'internal'));

      lastToast().actions[0].run();
      await settleDialog();

      expect(switches).toEqual([]);
      expect(toast.show).toHaveBeenCalledTimes(2);
    });
  });

  it('offers Try again after a server error, with its reference, and it switches', async () => {
    switchAnswer = () => throwError(() => apiError(500, 'internal'));

    await (await choose('docs')).done;

    expect(lastToast()?.message).toBe('Something went wrong. Reference: abcdef01');
    expect(lastToast()?.actions).toEqual([ expect.objectContaining({ label: `${K}.retry` }) ]);

    switchAnswer = () => of(undefined);
    lastToast().actions[0].run();
    await settleDialog();

    expect(switches).toEqual([ { name: 'docs', remote: false }, { name: 'docs', remote: false } ]);
    expect(toast.show).toHaveBeenCalledTimes(1);
  });

  it('Try again does nothing after going to another repository', async () => {
    switchAnswer = () => throwError(() => apiError(500, 'internal'));
    await (await choose('docs')).done;

    repository.set({ id: 13 });
    lastToast().actions[0].run();
    await settleDialog();

    expect(switches).toHaveLength(1);
  });
});
