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
  let statusStore: GitStatusStore;
  let store: MergeStore;

  const settle = async () => {
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    TestBed.tick();
  };
  const gitChanged = (repositoryId = 12) => events.next({ type: 'git.changed', repositoryId });

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
    TestBed.configureTestingModule({
      providers: [
        GitStatusStore,
        MergeStore,
        { provide: GitApi, useValue: { gitStatus, gitMerge } },
        { provide: PushChannelService, useValue: { events, reconnected } },
        { provide: RepositorySessionService, useValue: { state: signal('ready'), repository } }
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
    expect(store.resolvedCount()).toBe(2);
  });

  it('reads nothing without a merge', async () => {
    await start(false);

    expect(gitMerge).not.toHaveBeenCalled();
    expect(store.merging()).toBe(false);
    expect(store.state()).toBeNull();
    expect(store.resolvedCount()).toBe(0);
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
    expect(store.resolvedCount()).toBe(3);
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
    expect(store.resolvedCount()).toBe(2);
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

  it('has nothing after the merge ended', async () => {
    await start(true);

    gitStatus.mockReturnValue(of(status(false)));
    await statusStore.refresh();

    // Before the effects run: nothing may show the ended merge for a moment.
    expect(store.state()).toBeNull();
    expect(store.resolvedCount()).toBe(0);
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
});
