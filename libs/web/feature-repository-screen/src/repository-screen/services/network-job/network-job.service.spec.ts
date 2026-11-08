import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GitJobStarted, GitJobState, GitStatus, PushEvent } from '@front-burner/shared-contracts';
import { ToastService } from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { PushChannelService } from '@front-burner/web-core';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { translocoTesting } from '../../../testing/transloco-testing';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { LockedKeyService } from '../locked-key/locked-key.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { JOB_RETRY_MS, NetworkJobService } from './network-job.service';

const RUNNING: GitJobState = { status: 'running', outcome: null };
const PUSHED: GitJobState = { status: 'done', outcome: { kind: 'pushed', commits: 2, upstream: 'origin/main' } };
const FETCHED: GitJobState = { status: 'done', outcome: { kind: 'fetched', moved: false, upstreamMoved: false } };

function failed(code: string, params: Record<string, string> = {}): GitJobState {
  return { status: 'done', outcome: { kind: 'failed', code, params } };
}

function status(networkJob: GitStatus['networkJob'] = null): GitStatus {
  return {
    branch: 'main',
    noCommits: false,
    lastCommit: null,
    upstream: 'origin/main',
    upstreamGone: false,
    sameNameRemote: false,
    ahead: 2,
    behind: 0,
    changes: [],
    mergeInProgress: false,
    networkJob,
    fetchProblem: null
  };
}

function refused(code: string, params: Record<string, unknown> = {}): HttpErrorResponse {
  return new HttpErrorResponse({ status: 409, error: { code, params, message: code, requestId: 'r' } });
}

describe('NetworkJobService', () => {
  let push: ReturnType<typeof vi.fn<(id: number) => Observable<GitJobStarted>>>;
  let fetch: ReturnType<typeof vi.fn<(id: number) => Observable<GitJobStarted>>>;
  let gitJob: ReturnType<typeof vi.fn<(id: number, jobId: number) => Observable<GitJobState>>>;
  let events: Subject<PushEvent>;
  let reconnected: Subject<void>;
  let followed: ReturnType<typeof signal<number | null>>;
  let gitStatus: ReturnType<typeof signal<GitStatus | null>>;
  let refresh: ReturnType<typeof vi.fn>;
  let toast: { show: ReturnType<typeof vi.fn>; };
  let flushAll: ReturnType<typeof vi.fn>;
  let unlock: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  let service: NetworkJobService;

  const settle = async () => {
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
  };
  const finished = (jobId = 7) => events.next({ type: 'job.finished', jobId, outcome: 'done' });

  beforeEach(() => {
    vi.useFakeTimers();
    push = vi.fn(() => of({ jobId: 7 }));
    fetch = vi.fn(() => of({ jobId: 7 }));
    gitJob = vi.fn(() => of(RUNNING));
    events = new Subject();
    reconnected = new Subject();
    followed = signal(12);
    gitStatus = signal(status());
    refresh = vi.fn(async () => undefined);
    toast = { show: vi.fn() };
    flushAll = vi.fn(async () => undefined);
    unlock = vi.fn(async () => true);
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          // The test module has no ICU transpiler; en.json's plural is checked by the web application.
          'web-feature-repository-screen.NetworkJobService.pushed': 'Pushed {{ count }} commits to {{ upstream }}',
          'web-feature-repository-screen.NetworkJobService.noNewCommits': 'No new commits',
          'web-feature-repository-screen.NetworkJobService.noChangesReceived': 'No changes received for this branch'
        })
      ],
      providers: [
        NetworkJobService,
        { provide: GitApi, useValue: { push, fetch, gitJob } },
        { provide: PushChannelService, useValue: { events, reconnected } },
        { provide: GitStatusStore, useValue: { followed, status: gitStatus, refresh } },
        { provide: OpenFilesService, useValue: { flushAll } },
        { provide: LockedKeyService, useValue: { unlock } },
        { provide: ToastService, useValue: toast }
      ]
    });
    service = TestBed.inject(NetworkJobService);
  });

  afterEach(() => vi.useRealTimers());

  it('starts a push and follows its job', async () => {
    await service.start('push');
    await settle();

    expect(push).toHaveBeenCalledExactlyOnceWith(12);
    expect(gitJob).toHaveBeenCalledWith(12, 7);
    expect(service.running()).toBe('push');

    await service.start('push');
    expect(push).toHaveBeenCalledOnce();
  });

  describe('startWhenFree', () => {
    it('starts at once when nothing runs', async () => {
      await service.startWhenFree('fetch');
      await settle();

      expect(fetch).toHaveBeenCalledExactlyOnceWith(12);
    });

    it('waits for the running job, instead of being dropped', async () => {
      await service.start('push');
      await settle();

      await service.startWhenFree('fetch');
      await settle();
      expect(fetch).not.toHaveBeenCalled();

      gitJob.mockReturnValue(of(PUSHED));
      finished();
      await settle();
      await settle();

      expect(fetch).toHaveBeenCalledExactlyOnceWith(12);
    });

    it('runs what waits in order', async () => {
      await service.start('fetch');
      await settle();
      await service.startWhenFree('push');
      await service.startWhenFree('fetch', { background: true });

      gitJob.mockReturnValueOnce(of(failed('remote-failed')));
      finished();
      await settle();
      await settle();
      expect(push).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();

      gitJob.mockReturnValueOnce(of(failed('push-rejected')));
      finished();
      await settle();
      await settle();
      expect(fetch).toHaveBeenCalledTimes(2);
      // The background fetch leaves the push's problem where it is.
      expect(service.problem()?.code).toBe('push-rejected');
    });

    it('forgets what waits after a switch to another repository', async () => {
      await service.start('push');
      await settle();
      await service.startWhenFree('fetch');

      followed.set(13);
      await settle();
      await settle();

      expect(service.running()).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('a background fetch says nothing: no toast and no banner, whatever its end', async () => {
      gitJob.mockReturnValue(of(FETCHED));
      await service.startWhenFree('fetch', { background: true });
      await settle();
      expect(toast.show).not.toHaveBeenCalled();

      gitJob.mockReturnValue(of(failed('credentials-refused')));
      await service.startWhenFree('fetch', { background: true });
      await settle();
      expect(service.problem()).toBeNull();
    });

    it('a background fetch that is refused says nothing, and asks for no passphrase', async () => {
      fetch.mockReturnValueOnce(throwError(() => refused('key-locked', { keyId: 3, keyName: 'laptop' })));
      await service.startWhenFree('fetch', { background: true });
      await settle();
      expect(unlock).not.toHaveBeenCalled();
      expect(service.problem()).toBeNull();

      fetch.mockReturnValueOnce(throwError(() => refused('too-many-jobs')));
      await service.startWhenFree('fetch', { background: true });
      await settle();
      expect(service.problem()).toBeNull();
    });
  });

  it('shows the outcome after job.finished', async () => {
    await service.start('push');
    await settle();
    gitJob.mockReturnValue(of(PUSHED));

    finished(8);
    await settle();
    expect(service.running()).toBe('push');

    finished();
    await settle();

    expect(service.running()).toBeNull();
    expect(toast.show).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      message: 'Pushed 2 commits to origin/main',
      status: 'success'
    }));
    expect(service.problem()).toBeNull();
  });

  it('shows a failure as a problem, with its message and fix', async () => {
    gitJob.mockReturnValue(of(failed('credentials-refused', { branch: 'main', remoteMessages: 'denied' })));

    await service.start('push');
    await settle();

    expect(service.running()).toBeNull();
    expect(toast.show).not.toHaveBeenCalled();
    expect(service.problem()).toEqual({
      operation: 'push',
      code: 'credentials-refused',
      params: { branch: 'main', remoteMessages: 'denied' },
      messageKey: 'errors.credentials-refused',
      fix: 'fix-credentials',
      quiet: false
    });
  });

  it('reads the job again after a reconnect', async () => {
    await service.start('push');
    await settle();
    gitJob.mockReturnValue(of(PUSHED));

    // The job.finished was missed while the connection was down.
    reconnected.next();
    await settle();

    expect(service.running()).toBeNull();
    expect(toast.show).toHaveBeenCalledOnce();
  });

  it('reads a job whose state could not be read again later', async () => {
    await service.start('push');
    await settle();
    gitJob.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    finished();
    await settle();
    expect(service.running()).toBe('push');

    gitJob.mockReturnValue(of(PUSHED));
    await vi.advanceTimersByTimeAsync(JOB_RETRY_MS);

    expect(service.running()).toBeNull();
  });

  it('takes up a running push from the status', async () => {
    gitStatus.set(status({ id: 9, type: 'push' }));
    await settle();

    expect(gitJob).toHaveBeenCalledWith(12, 9);
    expect(service.running()).toBe('push');

    gitJob.mockReturnValue(of(PUSHED));
    finished(9);
    await settle();

    expect(service.running()).toBeNull();
    expect(refresh).toHaveBeenCalled();
    // Only the tab that started it says so.
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('shows another tab\'s push as running, and its failure only quietly', async () => {
    gitStatus.set(status({ id: 9, type: 'push' }));
    await settle();
    expect(service.running()).toBe('push');

    await service.start('push');
    expect(push).not.toHaveBeenCalled();

    gitJob.mockReturnValue(of(failed('push-non-fast-forward')));
    finished(9);
    await settle();

    expect(service.problem()).toEqual(expect.objectContaining({ code: 'push-non-fast-forward', quiet: true }));
  });

  it('starts nothing while another job runs', async () => {
    gitStatus.set(status({ id: 9, type: 'push' }));
    await settle();
    expect(service.running()).toBe('push');

    await service.start('push');
    expect(push).not.toHaveBeenCalled();
  });

  it('starts nothing while a job is being started', async () => {
    push.mockReturnValueOnce(new Subject<GitJobStarted>());
    void service.start('push');
    expect(service.running()).toBe('push');

    await service.start('push');

    expect(push).toHaveBeenCalledOnce();
  });

  it('retries the operation of a job taken up from the status', async () => {
    gitStatus.set(status({ id: 9, type: 'push' }));
    await settle();
    gitJob.mockReturnValue(of(failed('remote-timeout')));
    finished(9);
    await settle();
    expect(service.problem()).toEqual(expect.objectContaining({ operation: 'push', fix: 'retry', quiet: true }));
    expect(push).not.toHaveBeenCalled();

    await service.retry();

    expect(push).toHaveBeenCalledExactlyOnceWith(12);
  });

  it('does not take up a push again from a status read before it ended', async () => {
    gitJob.mockReturnValue(of(PUSHED));
    await service.start('push');
    await settle();
    gitJob.mockClear();

    gitStatus.set(status({ id: 7, type: 'push' }));
    await settle();

    expect(gitJob).not.toHaveBeenCalled();
    expect(service.running()).toBeNull();
  });

  it('shows a push the backend refused to start as a problem', async () => {
    push.mockReturnValue(throwError(() => refused('nothing-to-push')));

    await service.start('push');

    expect(service.running()).toBeNull();
    expect(service.problem()).toEqual({
      operation: 'push',
      code: 'nothing-to-push',
      params: {},
      messageKey: 'errors.nothing-to-push',
      fix: null,
      quiet: false
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('asks for the passphrase of a locked key, and pushes after the unlock without another press', async () => {
    push.mockReturnValueOnce(throwError(() => refused('key-locked', { keyId: 3, keyName: 'laptop' })));

    await service.start('push');
    await settle();

    expect(unlock).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledTimes(2);
    expect(service.running()).toBe('push');
    expect(service.problem()).toBeNull();
  });

  it('cancelling the passphrase cancels the push, with no message', async () => {
    unlock.mockResolvedValue(false);
    push.mockReturnValueOnce(throwError(() => refused('key-locked', { keyId: 3, keyName: 'laptop' })));

    await service.start('push');

    expect(push).toHaveBeenCalledOnce();
    expect(service.running()).toBeNull();
    expect(service.problem()).toBeNull();
  });

  it('asks once per press: a key locked again at once shows the problem, with Unlock', async () => {
    push.mockReturnValue(throwError(() => refused('key-locked', { keyId: 3, keyName: 'laptop' })));

    await service.start('push');

    expect(unlock).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledTimes(2);
    expect(service.problem()).toEqual({
      operation: 'push',
      code: 'key-locked',
      params: { keyId: '3', keyName: 'laptop' },
      messageKey: 'web-feature-repository-screen.gitProblem.key-locked',
      fix: 'unlock',
      quiet: false
    });
  });

  it('Unlock on the problem pushes again once the key is unlocked', async () => {
    push.mockReturnValueOnce(throwError(() => refused('key-locked', { keyId: 3, keyName: 'laptop' })));
    unlock.mockRejectedValueOnce(new Error('offline'));
    await service.start('push');
    expect(service.problem()).toMatchObject({ operation: 'push', fix: 'unlock' });

    await service.unlockAndRetry();

    expect(unlock).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledTimes(2);
    expect(service.problem()).toBeNull();
  });

  it('shows the problem, with Unlock, when the key can\'t be read to ask for it', async () => {
    push.mockReturnValue(throwError(() => refused('key-locked', { keyId: 3, keyName: 'laptop' })));
    unlock.mockRejectedValue(new Error('offline'));

    await service.start('push');
    expect(service.problem()).toMatchObject({ code: 'key-locked', params: { keyId: '3', keyName: 'laptop' } });

    await service.unlockAndRetry();
    expect(push).toHaveBeenCalledOnce();
    expect(service.problem()).toMatchObject({ code: 'key-locked', fix: 'unlock', params: { keyName: 'laptop' } });
  });

  it('clears a locked-key problem when the key is unlocked from the banner or another tab', async () => {
    push.mockReturnValue(throwError(() => refused('key-locked', { keyId: 3, keyName: 'laptop' })));
    unlock.mockRejectedValueOnce(new Error('offline'));
    await service.start('push');
    // Unlocked, but locked again at once: the problem shows, with Unlock.
    await service.unlockAndRetry();
    expect(service.problem()?.code).toBe('key-locked');

    events.next({ type: 'key.unlocked', keyId: 4 });
    expect(service.problem()?.code).toBe('key-locked');

    events.next({ type: 'key.unlocked', keyId: 3 });
    expect(service.problem()).toBeNull();
  });

  it('does not push another repository after a switch while the passphrase was asked for', async () => {
    push.mockReturnValueOnce(throwError(() => refused('key-locked', { keyId: 3, keyName: 'laptop' })));
    unlock.mockImplementationOnce(async () => {
      followed.set(13);
      return true;
    });

    await service.start('push');

    expect(push).toHaveBeenCalledOnce();
  });

  it('offers Try again for a network failure, and retry pushes again', async () => {
    push.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })));

    await service.start('push');
    expect(service.problem()?.fix).toBe('retry');

    await service.retry();
    expect(push).toHaveBeenCalledTimes(2);
    expect(service.problem()).toBeNull();
  });

  it('refreshes the status when a push ends', async () => {
    await service.start('push');
    await settle();
    refresh.mockClear();
    gitJob.mockReturnValue(of(PUSHED));

    finished();
    await settle();

    expect(refresh).toHaveBeenCalledOnce();
  });

  it('does not flush saves', async () => {
    await service.start('push');
    await settle();

    expect(flushAll).not.toHaveBeenCalled();
  });

  it('forgets the push and its problem in another repository', async () => {
    push.mockReturnValueOnce(throwError(() => refused('push-rejected')));
    await service.start('push');
    expect(service.problem()).not.toBeNull();

    followed.set(13);
    await settle();

    expect(service.problem()).toBeNull();
  });

  it('clears an old failure when it takes up another tab\'s push', async () => {
    push.mockReturnValueOnce(throwError(() => refused('push-rejected')));
    await service.start('push');
    expect(service.problem()).not.toBeNull();

    gitStatus.set(status({ id: 9, type: 'push' }));
    await settle();
    expect(service.running()).toBe('push');
    expect(service.problem()).toBeNull();

    gitJob.mockReturnValue(of(PUSHED));
    finished(9);
    await settle();

    expect(service.problem()).toBeNull();
  });

  it('keeps a push of another repository starting when the first one\'s request answers', async () => {
    const first = new Subject<GitJobStarted>();
    const second = new Subject<GitJobStarted>();
    push.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const started = service.start('push');
    followed.set(13);
    await settle();
    void service.start('push');
    expect(push).toHaveBeenLastCalledWith(13);

    first.next({ jobId: 7 });
    first.complete();
    await started;

    expect(service.running()).toBe('push');
    await service.start('push');
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('clears the problem', async () => {
    push.mockReturnValueOnce(throwError(() => refused('push-rejected')));
    await service.start('push');

    service.clearProblem();

    expect(service.problem()).toBeNull();
  });

  describe('a fetch', () => {
    const NOTHING_MOVED: GitJobState = {
      status: 'done',
      outcome: { kind: 'fetched', moved: false, upstreamMoved: false }
    };
    const OTHER_BRANCH_MOVED: GitJobState = {
      status: 'done',
      outcome: { kind: 'fetched', moved: true, upstreamMoved: false }
    };
    const MOVED: GitJobState = { status: 'done', outcome: { kind: 'fetched', moved: true, upstreamMoved: true } };

    it('starts a fetch and follows its job', async () => {
      await service.start('fetch');
      await settle();

      expect(fetch).toHaveBeenCalledExactlyOnceWith(12);
      expect(push).not.toHaveBeenCalled();
      expect(gitJob).toHaveBeenCalledWith(12, 7);
      expect(service.running()).toBe('fetch');
    });

    it('says No new commits when nothing moved', async () => {
      gitJob.mockReturnValue(of(NOTHING_MOVED));

      await service.start('fetch');
      await settle();

      expect(service.running()).toBeNull();
      expect(toast.show).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        message: 'No new commits',
        status: 'success'
      }));
      expect(refresh).toHaveBeenCalled();
    });

    it('says no changes were received when only another branch moved', async () => {
      gitJob.mockReturnValue(of(OTHER_BRANCH_MOVED));

      await service.start('fetch');
      await settle();

      expect(service.running()).toBeNull();
      expect(toast.show).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        message: 'No changes received for this branch',
        status: 'success'
      }));
      expect(refresh).toHaveBeenCalled();
    });

    it('says nothing when the upstream moved, it only updates the counts', async () => {
      gitJob.mockReturnValue(of(MOVED));

      await service.start('fetch');
      await settle();

      expect(toast.show).not.toHaveBeenCalled();
      expect(refresh).toHaveBeenCalled();
    });

    it('says nothing for another tab\'s fetch that moved only another branch', async () => {
      gitStatus.set(status({ id: 9, type: 'fetch' }));
      await settle();

      gitJob.mockReturnValue(of(OTHER_BRANCH_MOVED));
      finished(9);
      await settle();

      expect(service.running()).toBeNull();
      expect(toast.show).not.toHaveBeenCalled();
    });

    it('says nothing for a fetch taken up from the status', async () => {
      gitStatus.set(status({ id: 9, type: 'fetch' }));
      await settle();
      expect(service.running()).toBe('fetch');

      gitJob.mockReturnValue(of(NOTHING_MOVED));
      finished(9);
      await settle();

      expect(service.running()).toBeNull();
      expect(toast.show).not.toHaveBeenCalled();

      // A failed one is a problem, but a quiet one.
      gitJob.mockReturnValue(of(RUNNING));
      gitStatus.set(status({ id: 10, type: 'fetch' }));
      await settle();
      expect(service.running()).toBe('fetch');
      gitJob.mockReturnValue(of(failed('network-unreachable')));
      finished(10);
      await settle();

      expect(service.problem()).toEqual(expect.objectContaining({
        operation: 'fetch',
        code: 'network-unreachable',
        quiet: true
      }));
    });

    it('asks for a locked key, then fetches', async () => {
      fetch.mockReturnValueOnce(throwError(() => refused('key-locked', { keyId: 3, keyName: 'laptop' })));

      await service.start('fetch');
      await settle();

      expect(unlock).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(service.running()).toBe('fetch');
      expect(service.problem()).toBeNull();
    });

    it('clears the problem when it runs again', async () => {
      gitJob.mockReturnValue(of(failed('network-unreachable')));
      await service.start('fetch');
      await settle();
      expect(service.problem()).toEqual(expect.objectContaining({ operation: 'fetch', quiet: false }));

      const answer = new Subject<GitJobStarted>();
      fetch.mockReturnValueOnce(answer);
      gitJob.mockReturnValue(of(RUNNING));
      const started = service.start('fetch');

      // Cleared as the press starts, before the backend answers.
      expect(service.problem()).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(2);

      answer.next({ jobId: 7 });
      answer.complete();
      await started;
      await settle();
      expect(service.running()).toBe('fetch');
    });

    it('retries a failed fetch as a fetch, not a push', async () => {
      gitJob.mockReturnValue(of(failed('network-unreachable')));
      await service.start('fetch');
      await settle();
      expect(service.problem()).toEqual(expect.objectContaining({ operation: 'fetch', quiet: false }));

      gitJob.mockReturnValue(of(RUNNING));
      await service.retry();

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(push).not.toHaveBeenCalled();
    });

    it('Unlock on a locked-key problem of a fetch fetches again, not pushes', async () => {
      fetch.mockReturnValueOnce(throwError(() => refused('key-locked', { keyId: 3, keyName: 'laptop' })));
      unlock.mockRejectedValueOnce(new Error('offline'));
      await service.start('fetch');
      expect(service.problem()).toMatchObject({ operation: 'fetch', fix: 'unlock' });

      await service.unlockAndRetry();

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(push).not.toHaveBeenCalled();
    });
  });
});
