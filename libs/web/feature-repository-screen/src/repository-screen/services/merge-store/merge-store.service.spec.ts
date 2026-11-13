import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GitMergeState, GitStatus, PushEvent } from '@front-burner/shared-contracts';
import { GitApi } from '@front-burner/web-api-client';
import { PushChannelService } from '@front-burner/web-core';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { apiError } from '../../../testing/dialog-testing';
import { GitStatusStore, STATUS_REFRESH_MAX_MS, STATUS_RETRY_MS } from '../git-status-store/git-status-store.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';
import { MergeStore } from './merge-store.service';

function status(mergeInProgress: boolean): GitStatus {
  return {
    branch: 'main',
    noCommits: false,
    lastCommit: null,
    upstream: 'origin/main',
    upstreamGone: false,
    sameNameRemote: false,
    ahead: 0,
    behind: 0,
    changes: [],
    mergeInProgress,
    networkJob: null,
    undoableMerge: false,
    fetchProblem: null
  };
}

function merge(...resolved: boolean[]): GitMergeState {
  return {
    into: 'main',
    from: 'origin/main',
    files: resolved.map((isResolved, index) => ({
      path: `${index}.md`,
      kind: 'both-changed' as const,
      resolved: isResolved,
      edited: false,
      editable: true,
      oursSize: 1,
      theirsSize: 1
    })),
    otherFiles: [],
    message: 'Merge'
  };
}

describe('MergeStore', () => {
  let gitStatus: ReturnType<typeof vi.fn<(id: number) => Observable<GitStatus>>>;
  let gitMerge: ReturnType<typeof vi.fn<(id: number) => Observable<GitMergeState>>>;
  let events: Subject<PushEvent>;
  let reconnected: Subject<void>;
  let repository: ReturnType<typeof signal<{ id: number; }>>;
  let sessionState: ReturnType<typeof signal<string>>;
  let statusStore: GitStatusStore;
  let store: MergeStore;

  const settle = async () => {
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    TestBed.tick();
  };
  const gitChanged = (repositoryId = 12) => events.next({ type: 'git.changed', repositoryId });
  const resolved = () => store.state()?.files.filter(file => file.resolved).length ?? 0;

  /** Follows repository 12, whose status says whether a merge is in progress. */
  async function start(merging: boolean): Promise<void> {
    gitStatus.mockReturnValue(of(status(merging)));
    statusStore.start(12);
    await settle();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    gitStatus = vi.fn(() => of(status(false)));
    gitMerge = vi.fn(() => of(merge(true, false, true)));
    events = new Subject();
    reconnected = new Subject();
    repository = signal({ id: 12 });
    sessionState = signal('ready');
    TestBed.configureTestingModule({
      providers: [
        GitStatusStore,
        MergeStore,
        { provide: GitApi, useValue: { gitStatus, gitMerge } },
        { provide: PushChannelService, useValue: { events, reconnected } },
        { provide: RepositorySessionService, useValue: { state: sessionState, repository } }
      ]
    });
    statusStore = TestBed.inject(GitStatusStore);
    store = TestBed.inject(MergeStore);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the merge when the status says one is in progress', async () => {
    await start(true);

    expect(gitMerge).toHaveBeenCalledExactlyOnceWith(12);
    expect(store.merging()).toBe(true);
    expect(store.state()?.from).toBe('origin/main');
    expect(resolved()).toBe(2);
  });

  it('reads nothing without a merge', async () => {
    await start(false);

    expect(gitMerge).not.toHaveBeenCalled();
    expect(store.merging()).toBe(false);
    expect(store.state()).toBeNull();
    expect(resolved()).toBe(0);
  });

  it('is merging before the first read has been answered', async () => {
    const answer = new Subject<GitMergeState>();
    gitMerge.mockReturnValue(answer);

    await start(true);

    expect(store.merging()).toBe(true);
    expect(store.state()).toBeNull();
  });

  it('follows a merge started elsewhere', async () => {
    await start(false);

    gitStatus.mockReturnValue(of(status(true)));
    gitChanged();
    await settle();

    expect(store.merging()).toBe(true);
    expect(store.state()).not.toBeNull();
  });

  it('follows a merge ended elsewhere', async () => {
    await start(true);

    gitStatus.mockReturnValue(of(status(false)));
    gitMerge.mockReturnValue(throwError(() => apiError(409, 'no-merge-in-progress')));
    gitChanged();
    await settle();

    expect(store.merging()).toBe(false);
    expect(store.state()).toBeNull();
  });

  it('reads again after a reconnect', async () => {
    await start(true);
    gitMerge.mockClear();
    gitMerge.mockReturnValue(of(merge(true, true, true)));

    reconnected.next();
    await settle();

    expect(gitMerge).toHaveBeenCalledOnce();
    expect(resolved()).toBe(3);
  });

  it('makes good a merge it missed, on reconnect', async () => {
    await start(false);

    gitStatus.mockReturnValue(of(status(true)));
    reconnected.next();
    await settle();

    expect(store.merging()).toBe(true);
    expect(store.state()).not.toBeNull();
  });

  it('reads again on git.changed', async () => {
    await start(true);
    gitMerge.mockClear();
    gitMerge.mockReturnValue(of(merge(true, true, false)));

    gitChanged();
    await settle();

    expect(gitMerge).toHaveBeenCalledOnce();
    expect(resolved()).toBe(2);
  });

  it('ignores the git.changed of another repository', async () => {
    await start(true);
    gitMerge.mockClear();

    gitChanged(13);
    await settle();

    expect(gitMerge).not.toHaveBeenCalled();
  });

  it('does not read again on files.changed', async () => {
    await start(true);
    gitMerge.mockClear();

    events.next({ type: 'files.changed', repositoryId: 12, folders: [ '' ] });
    await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MAX_MS);
    await settle();

    // The status is read after it, and still says the same.
    expect(gitStatus).toHaveBeenCalledTimes(2);
    expect(gitMerge).not.toHaveBeenCalled();
  });

  it('treats no merge as its end', async () => {
    await start(true);
    gitMerge.mockReturnValue(throwError(() => apiError(409, 'no-merge-in-progress')));
    gitStatus.mockClear();
    gitStatus.mockReturnValue(of(status(false)));

    await store.refresh();
    await settle();

    expect(store.merging()).toBe(false);
    expect(store.state()).toBeNull();
    expect(gitStatus).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(STATUS_RETRY_MS);
    expect(gitMerge).toHaveBeenCalledTimes(2);
  });

  it('ends the merge at once on no merge, also when the status cannot be read', async () => {
    await start(true);
    gitMerge.mockReturnValue(throwError(() => apiError(409, 'no-merge-in-progress')));
    gitStatus.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));

    await store.refresh();
    await settle();

    expect(store.merging()).toBe(false);
  });

  it('reads once per event while the status calls a rebase a merge', async () => {
    // `GET …/git/status` answers yes to a rebase, and `GET …/git/merge` no.
    gitMerge.mockReturnValue(throwError(() => apiError(409, 'no-merge-in-progress')));

    await start(true);
    await vi.advanceTimersByTimeAsync(STATUS_RETRY_MS);
    await settle();

    expect(gitMerge).toHaveBeenCalledOnce();
    expect(store.merging()).toBe(false);

    gitChanged();
    await settle();

    expect(gitMerge).toHaveBeenCalledTimes(2);
    expect(store.merging()).toBe(false);
  });

  it('follows a new merge after the last one ended', async () => {
    await start(true);
    gitMerge.mockReturnValueOnce(throwError(() => apiError(409, 'no-merge-in-progress')));
    gitStatus.mockReturnValue(of(status(false)));
    await store.refresh();
    await settle();

    gitStatus.mockReturnValue(of(status(true)));
    await statusStore.refresh();
    await settle();

    expect(store.merging()).toBe(true);
    expect(store.state()).not.toBeNull();
  });

  it('keeps the merge when a read fails', async () => {
    await start(true);
    gitMerge.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));

    gitChanged();
    await settle();

    expect(store.merging()).toBe(true);
    expect(store.state()?.from).toBe('origin/main');
  });

  it('tries a failed read again, since an idle repository sends no event', async () => {
    gitMerge.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await start(true);
    expect(store.merging()).toBe(true);
    expect(store.state()).toBeNull();

    gitMerge.mockReturnValue(of(merge(false)));
    await vi.advanceTimersByTimeAsync(STATUS_RETRY_MS);
    await settle();

    expect(store.state()?.files).toHaveLength(1);
  });

  it('does not try a refused read again', async () => {
    gitMerge.mockReturnValue(throwError(() => apiError(404, 'repository-not-found')));
    await start(true);

    await vi.advanceTimersByTimeAsync(STATUS_RETRY_MS * 2);
    await settle();

    expect(gitMerge).toHaveBeenCalledOnce();
    expect(store.merging()).toBe(true);
  });

  it('reads nothing while the session does not have the repository ready, and again once it has', async () => {
    gitMerge.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    await start(true);
    gitMerge.mockClear();

    sessionState.set('not-openable');
    await settle();
    gitChanged();
    reconnected.next();
    await vi.advanceTimersByTimeAsync(STATUS_RETRY_MS * 2);
    await settle();

    expect(gitMerge).not.toHaveBeenCalled();

    sessionState.set('ready');
    await settle();

    expect(gitMerge).toHaveBeenCalledOnce();
    expect(store.state()).not.toBeNull();
  });

  it('has nothing after the merge ended', async () => {
    await start(true);

    gitStatus.mockReturnValue(of(status(false)));
    await statusStore.refresh();

    // Before the effects run: nothing may show the ended merge for a moment.
    expect(store.state()).toBeNull();
    expect(resolved()).toBe(0);
    await settle();
    expect(store.state()).toBeNull();

    gitStatus.mockReturnValue(of(status(true)));
    const answer = new Subject<GitMergeState>();
    gitMerge.mockReturnValue(answer);
    await statusStore.refresh();
    await settle();
    expect(store.merging()).toBe(true);
    expect(store.state()).toBeNull();
  });

  it('has nothing of the last repository after a switch', async () => {
    await start(true);
    const late = new Subject<GitMergeState>();
    gitMerge.mockReturnValue(late);
    void store.refresh();

    repository.set({ id: 13 });
    const next = new Subject<GitStatus>();
    gitStatus.mockReturnValue(next);
    statusStore.start(13);

    expect(store.merging()).toBe(false);
    expect(store.state()).toBeNull();
    await settle();

    gitMerge.mockClear();
    gitMerge.mockReturnValue(new Subject<GitMergeState>());
    next.next(status(true));
    await settle();
    late.next(merge(true));

    expect(gitMerge).toHaveBeenCalledExactlyOnceWith(13);
    expect(store.merging()).toBe(true);
    expect(store.state()).toBeNull();
  });

  describe('the selected file', () => {
    /** A merge whose files have these paths, all unresolved unless named in `resolved`. */
    function mergeOf(paths: string[], resolvedPaths: string[] = []): GitMergeState {
      const state = merge(...paths.map(path => resolvedPaths.includes(path)));
      return { ...state, files: state.files.map((file, index) => ({ ...file, path: paths[index] })) };
    }

    async function readAgain(state: GitMergeState): Promise<void> {
      gitMerge.mockReturnValue(of(state));
      gitChanged();
      await settle();
    }

    it('selects the first unresolved file', async () => {
      await start(true);

      expect(store.selected()).toBe('1.md');
      expect(store.selectedFile()?.path).toBe('1.md');
    });

    it('selects the first file when all are resolved', async () => {
      gitMerge.mockReturnValue(of(merge(true, true)));
      await start(true);

      expect(store.selected()).toBe('0.md');
    });

    it('selects nothing before the merge is read, nor without one', async () => {
      gitMerge.mockReturnValue(new Subject<GitMergeState>());
      await start(true);
      expect(store.selected()).toBeNull();
      expect(store.selectedFile()).toBeNull();

      gitStatus.mockReturnValue(of(status(false)));
      await statusStore.refresh();
      await settle();
      expect(store.selected()).toBeNull();
    });

    it('selects a listed file, and ignores a path that is not one', async () => {
      await start(true);

      store.select('2.md');
      expect(store.selected()).toBe('2.md');
      store.select('other.md');
      expect(store.selected()).toBe('2.md');
    });

    it('keeps the selection when the merge is read again', async () => {
      await start(true);
      store.select('2.md');

      await readAgain(merge(true, false, true));

      expect(store.selected()).toBe('2.md');
    });

    it('moves on when a read finds the file resolved, here or on another device', async () => {
      gitMerge.mockReturnValue(of(mergeOf([ 'a.md', 'b.md', 'c.md', 'd.md' ], [ 'c.md' ])));
      await start(true);
      expect(store.selected()).toBe('a.md');

      await readAgain(mergeOf([ 'a.md', 'b.md', 'c.md', 'd.md' ], [ 'a.md', 'c.md' ]));
      expect(store.selected()).toBe('b.md');

      // Past the end: the first unresolved file.
      store.select('d.md');
      await readAgain(mergeOf([ 'a.md', 'b.md', 'c.md', 'd.md' ], [ 'a.md', 'c.md', 'd.md' ]));
      expect(store.selected()).toBe('b.md');

      // None left: the file stays.
      await readAgain(mergeOf([ 'a.md', 'b.md', 'c.md', 'd.md' ], [ 'a.md', 'b.md', 'c.md', 'd.md' ]));
      expect(store.selected()).toBe('b.md');
    });

    it('moves on to the next unresolved file, and wraps round', async () => {
      gitMerge.mockReturnValue(of(mergeOf([ 'a.md', 'b.md', 'c.md' ], [])));
      await start(true);
      store.select('b.md');

      await readAgain(mergeOf([ 'a.md', 'b.md', 'c.md' ], [ 'b.md' ]));
      expect(store.selected()).toBe('c.md');

      await readAgain(mergeOf([ 'a.md', 'b.md', 'c.md' ], [ 'b.md', 'c.md' ]));
      expect(store.selected()).toBe('a.md');
    });

    it('stays on the last file', async () => {
      gitMerge.mockReturnValue(of(mergeOf([ 'a.md', 'b.md' ], [ 'a.md' ])));
      await start(true);
      expect(store.selected()).toBe('b.md');

      await readAgain(mergeOf([ 'a.md', 'b.md' ], [ 'a.md', 'b.md' ]));

      expect(store.selected()).toBe('b.md');
      expect(store.selectedFile()?.resolved).toBe(true);
    });

    it('keeps a resolved file that the user selected', async () => {
      gitMerge.mockReturnValue(of(mergeOf([ 'a.md', 'b.md' ], [ 'a.md' ])));
      await start(true);

      store.select('a.md');
      await readAgain(mergeOf([ 'a.md', 'b.md' ], [ 'a.md' ]));

      expect(store.selected()).toBe('a.md');
    });

    it('moves the selection when the file leaves the list', async () => {
      gitMerge.mockReturnValue(of(mergeOf([ 'a.md', 'b.md', 'c.md', 'd.md' ], [ 'c.md' ])));
      await start(true);
      store.select('b.md');

      await readAgain(mergeOf([ 'a.md', 'c.md', 'd.md' ], [ 'c.md' ]));
      expect(store.selected()).toBe('d.md');

      // Nothing unresolved after it: the first unresolved file, then the first file.
      await readAgain(mergeOf([ 'a.md', 'c.md' ], [ 'c.md' ]));
      expect(store.selected()).toBe('a.md');
      await readAgain(mergeOf([ 'c.md' ], [ 'c.md' ]));
      expect(store.selected()).toBe('c.md');
      await readAgain(mergeOf([]));
      expect(store.selected()).toBeNull();
    });

    it('says that a merge could not be read, until a read succeeds', async () => {
      gitMerge.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      await start(true);

      expect(store.state()).toBeNull();
      expect(store.failed()).toBe(true);

      gitMerge.mockReturnValue(of(merge(false)));
      await store.refresh();
      expect(store.failed()).toBe(false);
      expect(store.state()).not.toBeNull();

      // A merge known already stays shown when a later read fails.
      gitMerge.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      await store.refresh();
      expect(store.failed()).toBe(false);
      expect(store.state()).not.toBeNull();
    });

    it('does not say a merge that ended could not be read', async () => {
      gitMerge.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      await start(true);

      gitStatus.mockReturnValue(of(status(false)));
      await statusStore.refresh();
      await settle();

      expect(store.failed()).toBe(false);
    });

    it('starts again with the first unresolved file in the next merge', async () => {
      await start(true);
      store.select('2.md');

      gitStatus.mockReturnValue(of(status(false)));
      await statusStore.refresh();
      await settle();
      gitStatus.mockReturnValue(of(status(true)));
      await statusStore.refresh();
      await settle();

      expect(store.selected()).toBe('1.md');
    });
  });
});
