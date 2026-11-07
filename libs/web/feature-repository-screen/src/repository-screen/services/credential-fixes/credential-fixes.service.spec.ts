import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GitJobStarted, GitJobState, PushEvent, RepositorySummary } from '@front-burner/shared-contracts';
import { DialogService, ToastService } from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { PushChannelService } from '@front-burner/web-core';
import { RepositoryCredentialsDialog } from '@front-burner/web-repository-dialogs';
import { type Observable, of, Subject } from 'rxjs';

import { translocoTesting } from '../../../testing/transloco-testing';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { LockedKeyService } from '../locked-key/locked-key.service';
import { PushService } from '../push/push.service';
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

function failed(code: string): GitJobState {
  return { status: 'done', outcome: { kind: 'failed', code, params: {} } };
}

describe('CredentialFixesService', () => {
  let push: ReturnType<typeof vi.fn<(id: number) => Observable<GitJobStarted>>>;
  let gitJob: ReturnType<typeof vi.fn<(id: number, jobId: number) => Observable<GitJobState>>>;
  let open: ReturnType<typeof vi.fn>;
  let closed: Subject<boolean | undefined>;
  let followed: ReturnType<typeof signal<number | null>>;
  let lockedKey: { unlock: ReturnType<typeof vi.fn>; reread: ReturnType<typeof vi.fn>; };
  let pushes: PushService;
  let service: CredentialFixesService;

  const settle = async () => {
    TestBed.tick();
    await new Promise(resolve => setTimeout(resolve));
  };

  /** A push that failed with `code`, as the banner shows it. */
  async function failedPush(code: string): Promise<void> {
    gitJob.mockReturnValueOnce(of(failed(code)));
    await pushes.start();
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
    gitJob = vi.fn(() => of(failed('remote-failed')));
    closed = new Subject();
    open = vi.fn(() => ({ closed }));
    followed = signal(12);
    lockedKey = { unlock: vi.fn(async () => true), reread: vi.fn(async () => undefined) };
    TestBed.configureTestingModule({
      imports: [ translocoTesting() ],
      providers: [
        CredentialFixesService,
        PushService,
        { provide: GitApi, useValue: { push, gitJob } },
        { provide: PushChannelService, useValue: { events: new Subject<PushEvent>(), reconnected: new Subject() } },
        {
          provide: GitStatusStore,
          useValue: { followed, status: signal(null), refresh: vi.fn(async () => undefined) }
        },
        { provide: LockedKeyService, useValue: lockedKey },
        { provide: RepositorySessionService, useValue: { repository: signal(handbook) } },
        { provide: DialogService, useValue: { open } },
        { provide: ToastService, useValue: { show: vi.fn() } }
      ]
    });
    pushes = TestBed.inject(PushService);
    service = TestBed.inject(CredentialFixesService);
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
});
