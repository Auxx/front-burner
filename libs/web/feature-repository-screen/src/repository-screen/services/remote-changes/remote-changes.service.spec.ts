import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GitIncoming, GitNetworkJobType, GitStatus } from '@front-burner/shared-contracts';
import { GitApi } from '@front-burner/web-api-client';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { GitStatusStore, STATUS_RETRY_MS } from '../git-status-store/git-status-store.service';
import { NetworkJobService } from '../network-job/network-job.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { INCOMING_WAIT_MS, RemoteChangesService } from './remote-changes.service';

function gitStatus(behind: number, branch = 'main'): GitStatus {
  return {
    branch,
    noCommits: false,
    lastCommit: null,
    upstream: `origin/${branch}`,
    upstreamGone: false,
    sameNameRemote: false,
    ahead: 0,
    behind,
    changes: [],
    mergeInProgress: false,
    networkJob: null,
    fetchProblem: null
  };
}

function answer(touchesPath: boolean): Observable<GitIncoming> {
  return of({ incoming: { upstream: 'origin/main', commits: 1, touchesPath } });
}

describe('RemoteChangesService', () => {
  let incoming: ReturnType<typeof vi.fn<(id: number, query?: { path?: string; }) => Observable<GitIncoming>>>;
  let status: ReturnType<typeof signal<GitStatus | null>>;
  let followed: ReturnType<typeof signal<number | null>>;
  let readable: ReturnType<typeof signal<number | null>>;
  let pullSettling: ReturnType<typeof signal<boolean>>;
  let running: ReturnType<typeof signal<GitNetworkJobType | null>>;
  let current: ReturnType<typeof signal<{ path: () => string; } | null>>;
  let service: RemoteChangesService;

  const settle = async () => {
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    TestBed.tick();
  };
  const openFile = (path: string) => current.set({ path: () => path });

  beforeEach(() => {
    vi.useFakeTimers();
    incoming = vi.fn(() => answer(false));
    status = signal(null);
    followed = signal(12);
    readable = signal(12);
    pullSettling = signal(false);
    running = signal(null);
    current = signal(null);
    TestBed.configureTestingModule({
      providers: [
        RemoteChangesService,
        { provide: GitApi, useValue: { incoming } },
        { provide: GitStatusStore, useValue: { status, followed, readable } },
        { provide: NetworkJobService, useValue: { running, pullSettling } },
        { provide: OpenFilesService, useValue: { current } }
      ]
    });
    service = TestBed.inject(RemoteChangesService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says how many commits, and where', async () => {
    status.set(gitStatus(3));
    await settle();

    expect(service.notice()).toEqual({ commits: 3, upstream: 'origin/main', touchesOpenFile: false, announce: true });
    expect(incoming).toHaveBeenCalledExactlyOnceWith(12, undefined);
  });

  it('says This file changed too. for the open file', async () => {
    incoming.mockImplementation((_id, query) => answer(query?.path === 'guide.md'));
    openFile('guide.md');
    status.set(gitStatus(1));
    await settle();

    expect(incoming).toHaveBeenCalledExactlyOnceWith(12, { path: 'guide.md' });
    expect(service.notice()?.touchesOpenFile).toBe(true);
  });

  it('appears once the first read has answered, so that what it announces is whole', async () => {
    const read = new Subject<GitIncoming>();
    incoming.mockReturnValue(read);
    openFile('guide.md');
    status.set(gitStatus(1));
    await settle();

    expect(service.notice()).toBeNull();

    read.next({ incoming: { upstream: 'origin/main', commits: 1, touchesPath: true } });

    expect(service.notice()?.touchesOpenFile).toBe(true);
  });

  it('reads again for the open file, quietly', async () => {
    const read = new Subject<GitIncoming>();
    incoming.mockImplementation((_id, query) => query?.path === 'other.md' ? read : answer(true));
    openFile('guide.md');
    status.set(gitStatus(1));
    await settle();
    const before = service.notice();
    expect(before?.touchesOpenFile).toBe(true);

    openFile('other.md');
    await settle();

    // Stays on screen, without saying anything of a file it has no answer for.
    expect(service.notice()).toEqual({ commits: 1, upstream: 'origin/main', touchesOpenFile: false, announce: true });

    read.next({ incoming: { upstream: 'origin/main', commits: 1, touchesPath: true } });

    expect(service.notice()?.touchesOpenFile).toBe(true);
    expect(incoming).toHaveBeenLastCalledWith(12, { path: 'other.md' });
  });

  it('does not read again for a status that says the same', async () => {
    status.set(gitStatus(1));
    await settle();

    status.set({ ...gitStatus(1), ahead: 2 });
    await settle();

    expect(incoming).toHaveBeenCalledOnce();
  });

  it('keeps what it knows about the open file while more commits are read', async () => {
    const read = new Subject<GitIncoming>();
    incoming.mockReturnValueOnce(answer(true)).mockReturnValueOnce(read);
    openFile('guide.md');
    status.set(gitStatus(1));
    await settle();

    status.set(gitStatus(2));
    await settle();

    expect(service.notice()).toEqual({ commits: 2, upstream: 'origin/main', touchesOpenFile: true, announce: true });
    expect(incoming).toHaveBeenCalledTimes(2);
  });

  it('shows the count when incoming cannot be read, and tries again', async () => {
    incoming.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    openFile('guide.md');
    status.set(gitStatus(3));
    await settle();

    expect(service.notice()).toEqual({ commits: 3, upstream: 'origin/main', touchesOpenFile: false, announce: true });

    incoming.mockReturnValue(answer(true));
    await vi.advanceTimersByTimeAsync(STATUS_RETRY_MS);

    expect(service.notice()?.touchesOpenFile).toBe(true);
  });

  it('keeps This file changed too. when reading more commits fails, and after a refusal', async () => {
    openFile('guide.md');
    incoming.mockReturnValue(answer(true));
    status.set(gitStatus(1));
    await settle();

    incoming.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    status.set(gitStatus(2));
    await settle();
    expect(service.notice()).toEqual({ commits: 2, upstream: 'origin/main', touchesOpenFile: true, announce: true });

    incoming.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400 })));
    status.set(gitStatus(3));
    await settle();
    expect(service.notice()?.touchesOpenFile).toBe(true);
  });

  it('says nothing of another file when reading fails', async () => {
    openFile('guide.md');
    incoming.mockReturnValue(answer(true));
    status.set(gitStatus(1));
    await settle();

    incoming.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    openFile('other.md');
    await settle();

    expect(service.notice()?.touchesOpenFile).toBe(false);
  });

  it('shows the count alone when the first read takes long, and adds what it answers quietly', async () => {
    const read = new Subject<GitIncoming>();
    incoming.mockReturnValue(read);
    openFile('guide.md');
    status.set(gitStatus(3));
    await settle();

    await vi.advanceTimersByTimeAsync(INCOMING_WAIT_MS - 1);
    expect(service.notice()).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(service.notice()).toEqual({ commits: 3, upstream: 'origin/main', touchesOpenFile: false, announce: true });

    read.next({ incoming: { upstream: 'origin/main', commits: 3, touchesPath: true } });
    expect(service.notice()?.touchesOpenFile).toBe(true);
  });

  it('is not held back further by another file opened during the first read', async () => {
    incoming.mockReturnValue(new Subject<GitIncoming>());
    openFile('guide.md');
    status.set(gitStatus(3));
    await settle();

    await vi.advanceTimersByTimeAsync(INCOMING_WAIT_MS - 1);
    openFile('other.md');
    await settle();
    await vi.advanceTimersByTimeAsync(1);

    expect(service.notice()?.commits).toBe(3);
  });

  it('does not try again after a refusal', async () => {
    incoming.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400 })));
    status.set(gitStatus(3));
    await settle();

    await vi.advanceTimersByTimeAsync(STATUS_RETRY_MS);

    expect(incoming).toHaveBeenCalledOnce();
    expect(service.notice()?.commits).toBe(3);
  });

  it('comes back only when more commits arrive', async () => {
    status.set(gitStatus(3));
    await settle();

    service.dismiss();
    await settle();
    expect(service.notice()).toBeNull();

    status.set(gitStatus(3));
    await settle();
    expect(service.notice()).toBeNull();

    status.set(gitStatus(4));
    await settle();
    expect(service.notice()?.commits).toBe(4);
  });

  it('counts from what is left when the count falls', async () => {
    status.set(gitStatus(3));
    await settle();
    service.dismiss();
    await settle();

    status.set(gitStatus(0));
    await settle();
    status.set(gitStatus(2));
    await settle();

    expect(service.notice()?.commits).toBe(2);
  });

  it('goes when nothing is left to pull', async () => {
    status.set(gitStatus(3));
    await settle();
    expect(service.notice()).not.toBeNull();

    status.set(gitStatus(0));
    await settle();

    expect(service.notice()).toBeNull();
  });

  it('forgets the dismissal on another branch', async () => {
    status.set(gitStatus(3));
    await settle();
    service.dismiss();
    await settle();

    status.set(gitStatus(3, 'feature/x'));
    await settle();
    expect(service.notice()?.upstream).toBe('origin/feature/x');

    status.set(gitStatus(3));
    await settle();
    expect(service.notice()?.upstream).toBe('origin/main');
  });

  it('forgets the dismissal in another repository', async () => {
    status.set(gitStatus(3));
    await settle();
    service.dismiss();
    await settle();

    followed.set(13);
    readable.set(13);
    await settle();

    expect(service.notice()?.commits).toBe(3);
    expect(incoming).toHaveBeenLastCalledWith(13, undefined);
  });

  it('shows nothing during a merge, or a rebase, as the bar then offers no Pull', async () => {
    status.set({ ...gitStatus(3), mergeInProgress: true });
    await settle();

    expect(service.notice()).toBeNull();
    expect(incoming).not.toHaveBeenCalled();
  });

  it('shows nothing while a pull runs, and comes back if it fails, without a read or an announcement', async () => {
    openFile('guide.md');
    incoming.mockReturnValue(answer(true));
    status.set(gitStatus(3));
    await settle();

    running.set('pull');
    await settle();
    expect(service.notice()).toBeNull();

    running.set(null);
    await settle();
    expect(service.notice()).toEqual({ commits: 3, upstream: 'origin/main', touchesOpenFile: true, announce: false });
    expect(incoming).toHaveBeenCalledOnce();
  });

  it('announces again when more commits arrived since the pull started', async () => {
    status.set(gitStatus(3));
    await settle();
    running.set('pull');
    await settle();

    running.set(null);
    status.set(gitStatus(4));
    await settle();

    expect(service.notice()?.announce).toBe(true);
  });

  it('announces after a pull of another tab, when it was not shown before', async () => {
    const read = new Subject<GitIncoming>();
    incoming.mockReturnValue(read);
    running.set('pull');
    status.set(gitStatus(3));
    await settle();

    running.set(null);
    await settle();
    read.next({ incoming: { upstream: 'origin/main', commits: 3, touchesPath: false } });

    expect(service.notice()?.announce).toBe(true);
  });

  it('does not come back between the end of a pull and the status after it', async () => {
    status.set(gitStatus(3));
    await settle();

    running.set('pull');
    await settle();
    running.set(null);
    pullSettling.set(true);
    await settle();
    expect(service.notice()).toBeNull();

    status.set(gitStatus(0));
    pullSettling.set(false);
    await settle();

    expect(service.notice()).toBeNull();
    expect(incoming).toHaveBeenCalledOnce();
  });

  it('stays while another network job runs', async () => {
    status.set(gitStatus(3));
    await settle();

    running.set('fetch');
    await settle();

    expect(service.notice()?.commits).toBe(3);
    expect(incoming).toHaveBeenCalledOnce();
  });

  it('shows nothing while the repository cannot be read', async () => {
    readable.set(null);
    status.set(gitStatus(3));
    await settle();

    expect(service.notice()).toBeNull();
    expect(incoming).not.toHaveBeenCalled();
  });

  it('shows nothing without an upstream', async () => {
    status.set({ ...gitStatus(3), upstream: null });
    await settle();

    expect(service.notice()).toBeNull();
    expect(incoming).not.toHaveBeenCalled();
  });

  it('cancels a read that no longer counts', async () => {
    const read = new Subject<GitIncoming>();
    incoming.mockReturnValue(read);
    status.set(gitStatus(3));
    await settle();

    status.set(gitStatus(0));
    await settle();

    expect(read.observed).toBe(false);
  });
});
