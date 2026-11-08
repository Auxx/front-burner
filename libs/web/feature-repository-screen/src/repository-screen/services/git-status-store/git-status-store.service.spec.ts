import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GitStatus, PushEvent } from '@front-burner/shared-contracts';
import { GitApi } from '@front-burner/web-api-client';
import { PushChannelService } from '@front-burner/web-core';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { RepositorySessionService } from '../repository-session/repository-session.service';
import { GitStatusStore, STATUS_REFRESH_MAX_MS, STATUS_REFRESH_MS, STATUS_RETRY_MS } from './git-status-store.service';

function status(...paths: string[]): GitStatus {
  return {
    branch: 'main',
    noCommits: false,
    lastCommit: null,
    upstream: 'origin/main',
    upstreamGone: false,
    sameNameRemote: false,
    ahead: 0,
    behind: 0,
    changes: paths.map(path => ({ path, state: 'modified' as const })),
    mergeInProgress: false,
    networkJob: null,
    fetchProblem: null
  };
}

describe('GitStatusStore', () => {
  let gitStatus: ReturnType<typeof vi.fn<(id: number) => Observable<GitStatus>>>;
  let events: Subject<PushEvent>;
  let reconnected: Subject<void>;
  let state: ReturnType<typeof signal<string>>;
  let repository: ReturnType<typeof signal<{ id: number; } | null>>;
  let store: GitStatusStore;

  const settle = async () => {
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
  };
  const paths = () => store.status()?.changes.map(change => change.path);
  const filesChanged = (repositoryId = 12): void =>
    events.next({ type: 'files.changed', repositoryId, folders: [ '' ] });

  /** Starts on repository 12, once its first read has been answered. */
  async function start(): Promise<void> {
    store.start(12);
    await settle();
    gitStatus.mockClear();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    gitStatus = vi.fn(() => of(status('README.md')));
    events = new Subject();
    reconnected = new Subject();
    state = signal('ready');
    repository = signal({ id: 12 });
    TestBed.configureTestingModule({
      providers: [
        GitStatusStore,
        { provide: GitApi, useValue: { gitStatus } },
        { provide: PushChannelService, useValue: { events, reconnected } },
        { provide: RepositorySessionService, useValue: { state, repository } }
      ]
    });
    store = TestBed.inject(GitStatusStore);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the status when the repository is ready', async () => {
    state.set('loading');
    store.start(12);
    await settle();
    expect(gitStatus).not.toHaveBeenCalled();
    expect(store.status()).toBeNull();
    expect(store.changeCount()).toBe(0);

    state.set('ready');
    await settle();

    expect(gitStatus).toHaveBeenCalledExactlyOnceWith(12);
    expect(paths()).toEqual([ 'README.md' ]);
    expect(store.changeCount()).toBe(1);
  });

  it('does not read again when the session only reads the repository again', async () => {
    await start();

    repository.set({ id: 12 });
    await settle();

    expect(gitStatus).not.toHaveBeenCalled();
  });

  it('reads again when the repository is ready again', async () => {
    await start();

    state.set('not-openable');
    await settle();
    expect(gitStatus).not.toHaveBeenCalled();

    state.set('ready');
    await settle();
    expect(gitStatus).toHaveBeenCalledOnce();
  });

  it('reads at once on git.changed', async () => {
    await start();
    gitStatus.mockReturnValue(of(status('a.md', 'b.md')));

    events.next({ type: 'git.changed', repositoryId: 12 });
    await settle();

    expect(gitStatus).toHaveBeenCalledOnce();
    expect(store.changeCount()).toBe(2);
  });

  it('reads once after a burst of files.changed', async () => {
    await start();

    filesChanged();
    await vi.advanceTimersByTimeAsync(1000);
    filesChanged();
    await vi.advanceTimersByTimeAsync(1000);
    filesChanged();
    await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS - 1);
    expect(gitStatus).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(gitStatus).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS * 2);
    expect(gitStatus).toHaveBeenCalledOnce();
  });

  it('reads no later than the longest wait while files.changed keeps coming', async () => {
    await start();

    for (let waited = 0; waited < STATUS_REFRESH_MAX_MS - 1000; waited += 1000) {
      filesChanged();
      await vi.advanceTimersByTimeAsync(1000);
    }
    filesChanged();
    await vi.advanceTimersByTimeAsync(999);
    expect(gitStatus).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(gitStatus).toHaveBeenCalledOnce();

    // The next event starts a new wait.
    filesChanged();
    await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS - 1);
    expect(gitStatus).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(gitStatus).toHaveBeenCalledTimes(2);
  });

  it('waits no longer once a read has been asked for', async () => {
    await start();

    filesChanged();
    await store.refresh();
    expect(gitStatus).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS);
    expect(gitStatus).toHaveBeenCalledOnce();
  });

  it('reads again after a reconnect', async () => {
    await start();

    reconnected.next();
    await settle();

    expect(gitStatus).toHaveBeenCalledOnce();
  });

  it('keeps the last status when a read fails', async () => {
    await start();
    gitStatus.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));

    await store.refresh();

    expect(paths()).toEqual([ 'README.md' ]);
    expect(store.failed()).toBe(true);

    gitStatus.mockReturnValue(of(status()));
    await store.refresh();

    expect(store.status()?.changes).toEqual([]);
    expect(store.failed()).toBe(false);
  });

  it('tries a read that failed again, until one is answered', async () => {
    await start();
    gitStatus.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    await store.refresh();
    gitStatus.mockClear();

    await vi.advanceTimersByTimeAsync(STATUS_RETRY_MS - 1);
    expect(gitStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(gitStatus).toHaveBeenCalledOnce();

    gitStatus.mockReturnValue(of(status()));
    await vi.advanceTimersByTimeAsync(STATUS_RETRY_MS);
    expect(gitStatus).toHaveBeenCalledTimes(2);
    expect(store.failed()).toBe(false);

    await vi.advanceTimersByTimeAsync(STATUS_RETRY_MS * 2);
    expect(gitStatus).toHaveBeenCalledTimes(2);
  });

  it('cancels a read that a newer one replaces', async () => {
    await start();
    const older = new Subject<GitStatus>();
    gitStatus.mockReturnValueOnce(older).mockReturnValueOnce(new Subject());

    const first = store.refresh();
    expect(older.observed).toBe(true);
    void store.refresh();

    expect(older.observed).toBe(false);
    // Whoever waited for the cancelled read is not left waiting.
    await first;
  });

  it('ignores an answer older than the last one asked for', async () => {
    await start();
    const older = new Subject<GitStatus>();
    const newer = new Subject<GitStatus>();
    gitStatus.mockReturnValueOnce(older).mockReturnValueOnce(newer);

    const first = store.refresh();
    const second = store.refresh();
    newer.next(status('newer.md'));
    newer.complete();
    await second;
    older.next(status('older.md'));
    older.complete();
    await first;

    expect(paths()).toEqual([ 'newer.md' ]);
  });

  it('ignores the failure of a read older than the last one asked for', async () => {
    await start();
    const older = new Subject<GitStatus>();
    gitStatus.mockReturnValueOnce(older).mockReturnValueOnce(of(status('newer.md')));

    const first = store.refresh();
    await store.refresh();
    older.error(new HttpErrorResponse({ status: 500 }));
    await first;

    expect(store.failed()).toBe(false);
  });

  it('clears the status when the repository changes', async () => {
    await start();
    gitStatus.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    await store.refresh();
    expect(store.failed()).toBe(true);
    const late = new Subject<GitStatus>();
    gitStatus.mockReturnValueOnce(late);
    const asked = store.refresh();
    filesChanged();
    gitStatus.mockClear();

    state.set('loading');
    repository.set(null);
    store.start(13);

    expect(store.status()).toBeNull();
    expect(store.failed()).toBe(false);

    // Neither the old read's answer nor the old repository's wait counts any more.
    late.next(status('old.md'));
    late.complete();
    await asked;
    await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS);
    expect(store.status()).toBeNull();
    expect(gitStatus).not.toHaveBeenCalled();

    // The session still names the old repository until the new one has opened.
    state.set('ready');
    repository.set({ id: 12 });
    await settle();
    expect(gitStatus).not.toHaveBeenCalled();

    repository.set({ id: 13 });
    await settle();
    expect(gitStatus).toHaveBeenCalledExactlyOnceWith(13);
  });

  it('ignores events of other repositories', async () => {
    await start();

    events.next({ type: 'git.changed', repositoryId: 13 });
    filesChanged(13);
    await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS);

    expect(gitStatus).not.toHaveBeenCalled();
  });

  it('ignores other events of the repository', async () => {
    await start();

    events.next({ type: 'repository.status', repositoryId: 12, status: 'ready', error: null });
    await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS);

    expect(gitStatus).not.toHaveBeenCalled();
  });

  it('reads nothing while the repository is not ready', async () => {
    await start();
    state.set('not-openable');
    await settle();

    events.next({ type: 'git.changed', repositoryId: 12 });
    reconnected.next();
    await store.refresh();

    expect(gitStatus).not.toHaveBeenCalled();
  });

  it('stops following when it is destroyed', async () => {
    await start();
    filesChanged();

    TestBed.resetTestingModule();
    await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS);

    expect(gitStatus).not.toHaveBeenCalled();
    expect(events.observed).toBe(false);
    expect(reconnected.observed).toBe(false);
  });
});
