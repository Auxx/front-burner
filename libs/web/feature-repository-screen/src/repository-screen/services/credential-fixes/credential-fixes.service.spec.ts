import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  GitJobStarted,
  GitJobState,
  GitStatus,
  PushEvent,
  RepositorySummary
} from '@front-burner/shared-contracts';
import { DialogService, ToastService } from '@front-burner/ui';
import { GitApi, KnownHostsApi } from '@front-burner/web-api-client';
import { PushChannelService } from '@front-burner/web-core';
import {
  ChangedHostKeyDialog,
  RepositoryCredentialsDialog,
  TrustHostDialog
} from '@front-burner/web-repository-dialogs';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { translocoTesting } from '../../../testing/transloco-testing';
import { CommitAuthorGate } from '../commit-author-gate/commit-author-gate.service';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { LockedKeyService } from '../locked-key/locked-key.service';
import { NetworkJobService } from '../network-job/network-job.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';
import { CredentialFixesService } from './credential-fixes.service';

const handbook: RepositorySummary = {
  id: 12,
  name: 'Handbook',
  remote: 'github.com/acme/handbook',
  status: 'ready',
  error: null,
  warnings: [],
  lastAccessedAt: '2026-11-01T10:00:00.000Z'
};

function failed(code: string, params: Record<string, string> = {}): GitJobState {
  return { status: 'done', outcome: { kind: 'failed', code, params } };
}

const pushed: GitJobState = { status: 'done', outcome: { kind: 'pushed', commits: 1, upstream: 'origin/main' } };
const RUNNING: GitJobState = { status: 'running', outcome: null };

/** A push outcome's params of a changed host key, where the port is a string. */
const changedKeyParams = {
  host: 'git.example.com',
  port: '2222',
  type: 'ssh-ed25519',
  key: 'AAAAC3NzaC1lZDI1NTE5AAAAIH',
  fingerprint: 'SHA256:newfingerprint',
  trustedType: 'ssh-rsa',
  trustedFingerprint: 'SHA256:trustedfingerprint'
};

const unknownHostParams = {
  host: 'git.example.com',
  port: '2222',
  type: 'ssh-ed25519',
  key: 'AAAAC3NzaC1lZDI1NTE5AAAAIH',
  fingerprint: 'SHA256:newfingerprint'
};

describe('CredentialFixesService', () => {
  let push: ReturnType<typeof vi.fn<(id: number) => Observable<GitJobStarted>>>;
  let fetch: ReturnType<typeof vi.fn<(id: number) => Observable<GitJobStarted>>>;
  let pull: ReturnType<typeof vi.fn<(id: number) => Observable<GitJobStarted>>>;
  let gitJob: ReturnType<typeof vi.fn<(id: number, jobId: number) => Observable<GitJobState>>>;
  let open: ReturnType<typeof vi.fn>;
  let closed: Subject<boolean | undefined>;
  let followed: ReturnType<typeof signal<number | null>>;
  let gitStatus: ReturnType<typeof signal<GitStatus | null>>;
  let jobEvents: Subject<PushEvent>;
  let lockedKey: { unlock: ReturnType<typeof vi.fn>; reread: ReturnType<typeof vi.fn>; };
  let knownHosts: { trust: ReturnType<typeof vi.fn>; };
  let toast: { show: ReturnType<typeof vi.fn>; };
  let pushes: NetworkJobService;
  let service: CredentialFixesService;

  const settle = async () => {
    TestBed.tick();
    await new Promise(resolve => setTimeout(resolve));
  };

  /** A push that failed with `code`, as the banner shows it. */
  async function failedPush(code: string, params: Record<string, string> = {}): Promise<void> {
    gitJob.mockReturnValueOnce(of(failed(code, params)));
    await pushes.start('push');
    await settle();
  }

  /** Runs `fix`, and closes its dialog with `result`. */
  async function fix(name: Parameters<CredentialFixesService['run']>[0], result: boolean | undefined): Promise<void> {
    const running = service.run(name);
    await settle();
    closed.next(result);
    closed.complete();
    await running;
    await settle();
  }

  beforeEach(() => {
    push = vi.fn(() => of({ jobId: 7 }));
    fetch = vi.fn(() => of({ jobId: 8 }));
    pull = vi.fn(() => of({ jobId: 9 }));
    gitJob = vi.fn(() => of(failed('remote-failed')));
    closed = new Subject();
    open = vi.fn(() => ({ closed }));
    followed = signal(12);
    gitStatus = signal(null);
    jobEvents = new Subject();
    lockedKey = { unlock: vi.fn(async () => true), reread: vi.fn(async () => undefined) };
    knownHosts = { trust: vi.fn(() => of(undefined)) };
    toast = { show: vi.fn() };
    TestBed.configureTestingModule({
      imports: [ translocoTesting() ],
      providers: [
        CredentialFixesService,
        NetworkJobService,
        { provide: GitApi, useValue: { push, fetch, pull, gitJob } },
        {
          provide: OpenFilesService,
          useValue: { flushAll: vi.fn(async () => undefined), unsavedPaths: () => [], notSaved: () => null }
        },
        { provide: CommitAuthorGate, useValue: { ready: vi.fn(async () => true), refresh: vi.fn() } },
        { provide: PushChannelService, useValue: { events: jobEvents, reconnected: new Subject() } },
        {
          provide: GitStatusStore,
          useValue: { followed, status: gitStatus, refresh: vi.fn(async () => undefined) }
        },
        { provide: LockedKeyService, useValue: lockedKey },
        { provide: RepositorySessionService, useValue: { repository: signal(handbook) } },
        { provide: DialogService, useValue: { open } },
        { provide: ToastService, useValue: toast },
        { provide: KnownHostsApi, useValue: knownHosts }
      ]
    });
    pushes = TestBed.inject(NetworkJobService);
    service = TestBed.inject(CredentialFixesService);
  });

  describe('a problem of the last fetch, which no job here has shown', () => {
    const running = async (run: Promise<void>, result: boolean | undefined) => {
      await settle();
      closed.next(result);
      closed.complete();
      await run;
      await settle();
    };

    it('reviews the host key from the problem, and fetches once it is trusted', async () => {
      gitJob.mockReturnValue(of({ status: 'done', outcome: { kind: 'fetched', moved: false, upstreamMoved: false } }));

      await running(service.runFetchFix({ code: 'host-key-changed', params: changedKeyParams }), true);

      expect(open).toHaveBeenCalledExactlyOnceWith(ChangedHostKeyDialog, { data: { ...changedKeyParams, port: 2222 } });
      expect(fetch).toHaveBeenCalledExactlyOnceWith(12);
      expect(push).not.toHaveBeenCalled();
    });

    it('fetches after new credentials were saved, and not after Cancel', async () => {
      gitJob.mockReturnValue(of({ status: 'done', outcome: { kind: 'fetched', moved: false, upstreamMoved: false } }));
      const problem = { code: 'credentials-refused', params: {} };

      await running(service.runFetchFix(problem), undefined);
      expect(fetch).not.toHaveBeenCalled();

      closed = new Subject();
      await running(service.runFetchFix(problem), true);
      expect(open).toHaveBeenLastCalledWith(RepositoryCredentialsDialog, {
        data: { repository: handbook, hint: 'refused-key', offerTokenUpdate: true }
      });
      expect(fetch).toHaveBeenCalledExactlyOnceWith(12);
    });

    it('trusts the host from the problem, and fetches', async () => {
      gitJob.mockReturnValue(of({ status: 'done', outcome: { kind: 'fetched', moved: false, upstreamMoved: false } }));

      await running(service.runFetchFix({ code: 'host-key-unknown', params: unknownHostParams }), true);

      expect(open).toHaveBeenCalledWith(TrustHostDialog, expect.anything());
      expect(fetch).toHaveBeenCalledExactlyOnceWith(12);
    });

    it('fixes the given problem, not the failed push in the banner', async () => {
      await failedPush('host-key-changed', { ...changedKeyParams, host: 'push.example.com' });
      gitJob.mockReturnValue(of({ status: 'done', outcome: { kind: 'fetched', moved: false, upstreamMoved: false } }));

      await running(service.runFetchFix({ code: 'host-key-changed', params: changedKeyParams }), true);

      expect(open).toHaveBeenCalledWith(ChangedHostKeyDialog, { data: { ...changedKeyParams, port: 2222 } });
      expect(fetch).toHaveBeenCalledOnce();
      expect(push).toHaveBeenCalledOnce();
    });

    it('does nothing for a problem whose fix is only to run it again', async () => {
      await service.runFetchFix({ code: 'network', params: {} });

      expect(open).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('fetches after the running job, when a job started while the dialog was open', async () => {
      gitJob.mockReturnValue(of(RUNNING));
      const fixing = service.runFetchFix({ code: 'credentials-refused', params: {} });
      await settle();
      await pushes.start('push');
      await settle();

      closed.next(true);
      closed.complete();
      await fixing;
      await settle();
      expect(fetch).not.toHaveBeenCalled();

      gitJob.mockReturnValue(of(pushed));
      jobEvents.next({ type: 'job.finished', jobId: 7, outcome: 'done' });
      await settle();
      await settle();

      expect(fetch).toHaveBeenCalledExactlyOnceWith(12);
    });
  });

  describe('a credential fix from a push banner', () => {
    it('also fetches, quietly, while the last fetch\'s problem is stored', async () => {
      await failedPush('credentials-refused');
      gitStatus.set({ fetchProblem: { code: 'credentials-refused', params: {} } } as GitStatus);
      gitJob.mockReturnValue(of(pushed));

      await fix('fix-credentials', true);
      await settle();

      expect(push).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenCalledExactlyOnceWith(12);
    });

    it('fetches nothing when no problem is stored', async () => {
      await failedPush('credentials-refused');
      gitJob.mockReturnValue(of(pushed));

      await fix('fix-credentials', true);
      await settle();

      expect(fetch).not.toHaveBeenCalled();
    });

    it('re-runs the push after a running job, whose start cleared the banner', async () => {
      await failedPush('credentials-refused');
      gitJob.mockReturnValue(of(RUNNING));
      const fixing = service.run('fix-credentials');
      await settle();
      await pushes.start('fetch');
      await settle();

      closed.next(true);
      closed.complete();
      await fixing;
      await settle();
      expect(push).toHaveBeenCalledOnce();

      gitJob.mockReturnValue(of(pushed));
      jobEvents.next({ type: 'job.finished', jobId: 8, outcome: 'done' });
      await settle();
      await settle();

      expect(push).toHaveBeenCalledTimes(2);
    });
  });

  it('Add credentials opens the dialog, and the push runs again after saving', async () => {
    await failedPush('no-credentials');
    gitJob.mockReturnValueOnce(
      of({ status: 'done', outcome: { kind: 'pushed', commits: 1, upstream: 'origin/main' } })
    );

    await fix('add-credentials', true);

    expect(open).toHaveBeenCalledExactlyOnceWith(RepositoryCredentialsDialog, { data: { repository: handbook } });
    expect(push).toHaveBeenCalledTimes(2);
    expect(pushes.problem()).toBeNull();
    // The new credentials may be a locked key, for the banner.
    expect(lockedKey.reread).toHaveBeenCalledOnce();
  });

  it('the push does not wait for the key to be read again', async () => {
    await failedPush('no-credentials');
    lockedKey.reread.mockReturnValue(new Promise(() => undefined));

    await fix('add-credentials', true);

    expect(push).toHaveBeenCalledTimes(2);
  });

  it('Use other credentials opens the dialog', async () => {
    await failedPush('push-not-allowed');

    await fix('other-credentials', true);

    expect(open).toHaveBeenCalledWith(RepositoryCredentialsDialog, { data: { repository: handbook } });
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('Fix credentials opens the dialog with the hint for a refused key and the offer to update a token', async () => {
    await failedPush('credentials-refused');

    await fix('fix-credentials', true);

    // The dialog decides which applies to the credentials in use (RC-12, RC-14).
    expect(open).toHaveBeenCalledWith(RepositoryCredentialsDialog, {
      data: { repository: handbook, hint: 'refused-key', offerTokenUpdate: true }
    });
  });

  it('runs the push again after updating', async () => {
    await failedPush('credentials-refused');
    gitJob.mockReturnValueOnce(
      of({ status: 'done', outcome: { kind: 'pushed', commits: 1, upstream: 'origin/main' } })
    );

    await fix('fix-credentials', true);

    expect(push).toHaveBeenCalledTimes(2);
    expect(pushes.problem()).toBeNull();
  });

  it('Cancel leaves the push alone', async () => {
    await failedPush('no-credentials');

    await fix('add-credentials', undefined);

    expect(push).toHaveBeenCalledOnce();
    expect(lockedKey.reread).not.toHaveBeenCalled();
    expect(pushes.problem()?.code).toBe('no-credentials');
  });

  it('shows the next problem when the retried push fails', async () => {
    await failedPush('no-credentials');
    gitJob.mockReturnValueOnce(of(failed('push-not-allowed')));

    await fix('add-credentials', true);

    expect(pushes.problem()).toEqual(expect.objectContaining({ code: 'push-not-allowed', fix: 'other-credentials' }));
  });

  it('does not push another repository after a switch while the dialog was open', async () => {
    await failedPush('no-credentials');
    const running = service.run('add-credentials');
    await settle();

    followed.set(13);
    closed.next(true);
    closed.complete();
    await running;
    await settle();

    expect(push).toHaveBeenCalledOnce();
  });

  it('Try again and Unlock run through the push', async () => {
    await failedPush('remote-timeout');
    await service.run('retry');
    await settle();
    expect(push).toHaveBeenCalledTimes(2);

    await failedPush('key-locked');
    await service.run('unlock');
    await settle();
    expect(lockedKey.unlock).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('Review the new key opens the dialog with both keys, and the push runs again after trusting', async () => {
    await failedPush('host-key-changed', changedKeyParams);
    gitJob.mockReturnValueOnce(of(pushed));

    await fix('review-host-key', true);

    expect(open).toHaveBeenCalledExactlyOnceWith(ChangedHostKeyDialog, {
      data: { ...changedKeyParams, port: 2222 }
    });
    expect(push).toHaveBeenCalledTimes(2);
    expect(pushes.problem()).toBeNull();
  });

  it('Try again in the dialog of a key that could not be read runs the push again', async () => {
    const { host, port, trustedType, trustedFingerprint } = changedKeyParams;
    await failedPush('host-key-changed', { host, port, trustedType, trustedFingerprint });

    await fix('review-host-key', true);

    expect(open).toHaveBeenCalledWith(ChangedHostKeyDialog, {
      data: { host, port: 2222, trustedType, trustedFingerprint }
    });
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('does not run the push again when saving fails', async () => {
    await failedPush('host-key-changed', changedKeyParams);

    // The dialog stays open with the error until the user gives up.
    await fix('review-host-key', undefined);

    expect(push).toHaveBeenCalledOnce();
    expect(pushes.problem()?.code).toBe('host-key-changed');
  });

  it('Cancel changes nothing, and the push stays failed', async () => {
    await failedPush('host-key-changed', changedKeyParams);

    await fix('review-host-key', undefined);

    expect(push).toHaveBeenCalledOnce();
    expect(knownHosts.trust).not.toHaveBeenCalled();
    expect(pushes.problem()).toEqual(expect.objectContaining({ code: 'host-key-changed', fix: 'review-host-key' }));
  });

  it('does not push another repository after a switch while the host key dialog was open', async () => {
    await failedPush('host-key-changed', changedKeyParams);
    const running = service.run('review-host-key');
    await settle();

    followed.set(13);
    closed.next(true);
    closed.complete();
    await running;
    await settle();

    expect(push).toHaveBeenCalledOnce();
  });

  it('opens nothing for a changed host key without a host', async () => {
    await failedPush('host-key-changed', {});

    await service.run('review-host-key');
    await settle();

    expect(open).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledOnce();
  });

  it('a push that meets an unknown host asks to trust it, then runs again', async () => {
    await failedPush('host-key-unknown', unknownHostParams);
    gitJob.mockReturnValueOnce(of(pushed));

    await fix('trust-host', true);

    expect(open).toHaveBeenCalledExactlyOnceWith(TrustHostDialog, {
      data: { ...unknownHostParams, port: 2222 },
      size: 'small'
    });
    expect(knownHosts.trust).toHaveBeenCalledWith({
      host: 'git.example.com',
      port: 2222,
      type: 'ssh-ed25519',
      key: 'AAAAC3NzaC1lZDI1NTE5AAAAIH'
    });
    expect(push).toHaveBeenCalledTimes(2);
    expect(pushes.problem()).toBeNull();
  });

  it('Cancel on an unknown host trusts nothing, and the push stays failed', async () => {
    await failedPush('host-key-unknown', unknownHostParams);

    await fix('trust-host', false);

    expect(knownHosts.trust).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledOnce();
    expect(pushes.problem()?.code).toBe('host-key-unknown');
  });

  it('Pull on a push the remote refused pulls', async () => {
    await failedPush('push-non-fast-forward');

    await service.run('pull');

    expect(pull).toHaveBeenCalledExactlyOnceWith(12);
  });

  it('Pull waits for a job that runs, as a background fetch must not lose the press', async () => {
    await failedPush('push-non-fast-forward');
    gitJob.mockReturnValue(of(RUNNING));
    await pushes.start('fetch');
    await settle();

    await service.run('pull');
    expect(pull).not.toHaveBeenCalled();

    gitJob.mockReturnValue(of(pushed));
    jobEvents.next({ type: 'job.finished', jobId: 8, outcome: 'done' });
    await settle();
    await settle();

    expect(pull).toHaveBeenCalledOnce();
  });

  it('Show changes tells the page, and runs no job', async () => {
    const shown = vi.fn();
    service.showChanges.subscribe(shown);

    await service.run('show-changes');

    expect(shown).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    expect(pull).not.toHaveBeenCalled();
  });

  it('says why trusting an unknown host failed, and does not push', async () => {
    knownHosts.trust.mockReturnValue(throwError(() => new Error('offline')));
    await failedPush('host-key-unknown', unknownHostParams);

    await fix('trust-host', true);

    expect(push).toHaveBeenCalledOnce();
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ status: 'danger' }));
    expect(pushes.problem()?.code).toBe('host-key-unknown');
  });
});
