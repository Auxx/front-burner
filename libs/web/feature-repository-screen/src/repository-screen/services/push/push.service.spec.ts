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
import { JOB_RETRY_MS, PushService } from './push.service';

const RUNNING: GitJobState = { status: 'running', outcome: null };
const PUSHED: GitJobState = { status: 'done', outcome: { kind: 'pushed', commits: 2, upstream: 'origin/main' } };

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
    ahead: 2,
    behind: 0,
    changes: [],
    mergeInProgress: false,
    networkJob
  };
}

function refused(code: string, params: Record<string, unknown> = {}): HttpErrorResponse {
  return new HttpErrorResponse({ status: 409, error: { code, params, message: code, requestId: 'r' } });
}

describe('PushService', () => {
  let push: ReturnType<typeof vi.fn<(id: number) => Observable<GitJobStarted>>>;
  let gitJob: ReturnType<typeof vi.fn<(id: number, jobId: number) => Observable<GitJobState>>>;
  let events: Subject<PushEvent>;
  let reconnected: Subject<void>;
  let followed: ReturnType<typeof signal<number | null>>;
  let gitStatus: ReturnType<typeof signal<GitStatus | null>>;
  let refresh: ReturnType<typeof vi.fn>;
  let toast: { show: ReturnType<typeof vi.fn>; };
  let flushAll: ReturnType<typeof vi.fn>;
  let unlock: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  let service: PushService;

  const settle = async () => {
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
  };
  const finished = (jobId = 7) => events.next({ type: 'job.finished', jobId, outcome: 'done' });

  beforeEach(() => {
    vi.useFakeTimers();
    push = vi.fn(() => of({ jobId: 7 }));
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
          'web-feature-repository-screen.PushService.pushed': 'Pushed {{ count }} commits to {{ upstream }}'
        })
      ],
      providers: [
        PushService,
        { provide: GitApi, useValue: { push, gitJob } },
        { provide: PushChannelService, useValue: { events, reconnected } },
        { provide: GitStatusStore, useValue: { followed, status: gitStatus, refresh } },
        { provide: OpenFilesService, useValue: { flushAll } },
        { provide: LockedKeyService, useValue: { unlock } },
        { provide: ToastService, useValue: toast }
      ]
    });
    service = TestBed.inject(PushService);
  });

  afterEach(() => vi.useRealTimers());

  it('starts a push and follows its job', async () => {
    await service.start();
    await settle();

    expect(push).toHaveBeenCalledExactlyOnceWith(12);
    expect(gitJob).toHaveBeenCalledWith(12, 7);
    expect(service.running()).toBe(true);

    await service.start();
    expect(push).toHaveBeenCalledOnce();
  });

  it('shows the outcome after job.finished', async () => {
    await service.start();
    await settle();
    gitJob.mockReturnValue(of(PUSHED));

    finished(8);
    await settle();
    expect(service.running()).toBe(true);

    finished();
    await settle();

    expect(service.running()).toBe(false);
    expect(toast.show).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      message: 'Pushed 2 commits to origin/main',
      status: 'success'
    }));
    expect(service.problem()).toBeNull();
  });

  it('shows a failure as a problem, with its message and fix', async () => {
    gitJob.mockReturnValue(of(failed('credentials-refused', { branch: 'main', remoteMessages: 'denied' })));

    await service.start();
    await settle();

    expect(service.running()).toBe(false);
    expect(toast.show).not.toHaveBeenCalled();
    expect(service.problem()).toEqual({
      code: 'credentials-refused',
      params: { branch: 'main', remoteMessages: 'denied' },
      messageKey: 'errors.credentials-refused',
      fix: 'fix-credentials',
      quiet: false
    });
  });

  it('reads the job again after a reconnect', async () => {
    await service.start();
    await settle();
    gitJob.mockReturnValue(of(PUSHED));

    // The job.finished was missed while the connection was down.
    reconnected.next();
    await settle();

    expect(service.running()).toBe(false);
    expect(toast.show).toHaveBeenCalledOnce();
  });

  it('reads a job whose state could not be read again later', async () => {
    await service.start();
    await settle();
    gitJob.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    finished();
    await settle();
    expect(service.running()).toBe(true);

    gitJob.mockReturnValue(of(PUSHED));
    await vi.advanceTimersByTimeAsync(JOB_RETRY_MS);

    expect(service.running()).toBe(false);
  });

  it('takes up a running push from the status', async () => {
    gitStatus.set(status({ id: 9, type: 'push' }));
    await settle();

    expect(gitJob).toHaveBeenCalledWith(12, 9);
    expect(service.running()).toBe(true);

    gitJob.mockReturnValue(of(PUSHED));
    finished(9);
    await settle();

    expect(service.running()).toBe(false);
    expect(refresh).toHaveBeenCalled();
    // Only the tab that started it says so.
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('shows another tab\'s push as running, and its failure only quietly', async () => {
    gitStatus.set(status({ id: 9, type: 'push' }));
    await settle();
    expect(service.running()).toBe(true);

    await service.start();
    expect(push).not.toHaveBeenCalled();

    gitJob.mockReturnValue(of(failed('push-non-fast-forward')));
    finished(9);
    await settle();

    expect(service.problem()).toEqual(expect.objectContaining({ code: 'push-non-fast-forward', quiet: true }));
  });

  it('does not take up a push again from a status read before it ended', async () => {
    gitJob.mockReturnValue(of(PUSHED));
    await service.start();
    await settle();
    gitJob.mockClear();

    gitStatus.set(status({ id: 7, type: 'push' }));
    await settle();

    expect(gitJob).not.toHaveBeenCalled();
    expect(service.running()).toBe(false);
  });

  it('shows a push the backend refused to start as a problem', async () => {
    push.mockReturnValue(throwError(() => refused('nothing-to-push')));

    await service.start();

    expect(service.running()).toBe(false);
    expect(service.problem()).toEqual({
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

    await service.start();
    await settle();

    expect(unlock).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledTimes(2);
    expect(service.running()).toBe(true);
    expect(service.problem()).toBeNull();
  });

  it('cancelling the passphrase cancels the push, with no message', async () => {
    unlock.mockResolvedValue(false);
    push.mockReturnValueOnce(throwError(() => refused('key-locked', { keyId: 3, keyName: 'laptop' })));

    await service.start();

    expect(push).toHaveBeenCalledOnce();
    expect(service.running()).toBe(false);
    expect(service.problem()).toBeNull();
  });

  it('asks once per press: a key locked again at once shows the problem, with Unlock', async () => {
    push.mockReturnValue(throwError(() => refused('key-locked', { keyId: 3, keyName: 'laptop' })));

    await service.start();

    expect(unlock).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledTimes(2);
    expect(service.problem()).toEqual({
      code: 'key-locked',
      params: { keyId: '3', keyName: 'laptop' },
      messageKey: 'web-feature-repository-screen.pushProblem.key-locked',
      fix: 'unlock',
      quiet: false
    });
  });

  it('Unlock on the problem pushes again once the key is unlocked', async () => {
    push.mockReturnValueOnce(throwError(() => refused('key-locked', { keyId: 3, keyName: 'laptop' })));
    unlock.mockResolvedValueOnce(false);
    await service.start();

    await service.unlockAndRetry();

    expect(unlock).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledTimes(2);
    expect(service.problem()).toBeNull();
  });

  it('shows the problem, with Unlock, when the key can\'t be read to ask for it', async () => {
    push.mockReturnValue(throwError(() => refused('key-locked', { keyId: 3, keyName: 'laptop' })));
    unlock.mockRejectedValue(new Error('offline'));

    await service.start();
    expect(service.problem()).toMatchObject({ code: 'key-locked', params: { keyId: '3', keyName: 'laptop' } });

    await service.unlockAndRetry();
    expect(push).toHaveBeenCalledOnce();
    expect(service.problem()).toMatchObject({ code: 'key-locked', fix: 'unlock', params: { keyName: 'laptop' } });
  });

  it('clears a locked-key problem when the key is unlocked from the banner or another tab', async () => {
    push.mockReturnValue(throwError(() => refused('key-locked', { keyId: 3, keyName: 'laptop' })));
    unlock.mockResolvedValueOnce(false);
    await service.start();
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

    await service.start();

    expect(push).toHaveBeenCalledOnce();
  });

  it('offers Try again for a network failure, and retry pushes again', async () => {
    push.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })));

    await service.start();
    expect(service.problem()?.fix).toBe('retry');

    await service.retry();
    expect(push).toHaveBeenCalledTimes(2);
    expect(service.problem()).toBeNull();
  });

  it('refreshes the status when a push ends', async () => {
    await service.start();
    await settle();
    refresh.mockClear();
    gitJob.mockReturnValue(of(PUSHED));

    finished();
    await settle();

    expect(refresh).toHaveBeenCalledOnce();
  });

  it('does not flush saves', async () => {
    await service.start();
    await settle();

    expect(flushAll).not.toHaveBeenCalled();
  });

  it('forgets the push and its problem in another repository', async () => {
    push.mockReturnValueOnce(throwError(() => refused('push-rejected')));
    await service.start();
    expect(service.problem()).not.toBeNull();

    followed.set(13);
    await settle();

    expect(service.problem()).toBeNull();
  });

  it('clears an old failure when it takes up another tab\'s push', async () => {
    push.mockReturnValueOnce(throwError(() => refused('push-rejected')));
    await service.start();
    expect(service.problem()).not.toBeNull();

    gitStatus.set(status({ id: 9, type: 'push' }));
    await settle();
    expect(service.running()).toBe(true);
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
    const started = service.start();
    followed.set(13);
    await settle();
    void service.start();
    expect(push).toHaveBeenLastCalledWith(13);

    first.next({ jobId: 7 });
    first.complete();
    await started;

    expect(service.running()).toBe(true);
    await service.start();
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('clears the problem', async () => {
    push.mockReturnValueOnce(throwError(() => refused('push-rejected')));
    await service.start();

    service.clearProblem();

    expect(service.problem()).toBeNull();
  });
});
