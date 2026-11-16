import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { RepositoryCredentialsInfo, RepositoryDetails, RepositorySummary } from '@front-burner/shared-contracts';
import { DialogService, ToastService } from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { UnlockKeyDialog } from '@front-burner/web-repository-dialogs';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { apiFailure } from '../../../testing/api-failure';
import { repositoryDetails } from '../../../testing/repository-details';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RepositorySettingsStore } from '../../services/repository-settings-store/repository-settings-store.service';
import { CloneStatusComponent } from './clone-status.component';

const KEY = 'web-feature-repositories.CloneStatusComponent';
const DETAIL = 'web-shell.RepositoryStatusDetailComponent';

/** A failed clone, with git's error and the request ID. */
function failed(extra: Partial<Omit<RepositoryDetails, 'summary'>> = {}): RepositoryDetails {
  return repositoryDetails(
    { status: 'error', error: 'clone-failed' },
    { errorDetail: 'fatal: repository not found', errorRequestId: 'req-0123456789', ...extra }
  );
}

/** The API's answer to a retry: the repository, cloning. */
function cloning(): RepositorySummary {
  return repositoryDetails({ status: 'cloning', clone: { jobId: 9, state: 'waiting', percent: null } }).summary;
}

/** The repository's passphrase-protected key, locked unless `unlocked`. */
function sshKey(unlocked = false): RepositoryCredentialsInfo {
  return {
    protocol: 'ssh',
    inUse: {
      kind: 'ssh-key',
      id: 2,
      name: 'Laptop key',
      keyType: 'ed25519',
      fingerprint: 'SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
      passphraseProtected: true,
      unlocked,
      generated: false,
      missing: false,
      usedBy: 1
    }
  };
}

/** `409 key-locked` for the key with ID 2, as the backend refuses a clone with it. */
function keyLocked(): Observable<never> {
  return throwError(() =>
    new HttpErrorResponse({
      status: 409,
      error: { code: 'key-locked', params: { keyId: 2, keyName: 'Laptop key' }, requestId: 'req-2', message: 'locked' }
    })
  );
}

describe('CloneStatusComponent', () => {
  let fixture: ComponentFixture<CloneStatusComponent>;
  let toast: { show: ReturnType<typeof vi.fn>; };
  let cloneAnswers: Observable<RepositorySummary>[];
  let cloneRequests: number;
  let credentials: () => Observable<RepositoryCredentialsInfo>;
  let confirm: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  let unlockClosed: Subject<boolean | undefined>;
  let store: { cloning: ReturnType<typeof vi.fn>; reload: ReturnType<typeof vi.fn>; };

  const host = () => fixture.nativeElement as HTMLElement;
  const detailsButton = () => host().querySelector<HTMLButtonElement>('button.toggle');
  const region = () => host().querySelector('ui-collapsible');
  const message = () => host().querySelector('pre.message');
  const copyButton = () => host().querySelector<HTMLButtonElement>('button.copy');

  async function show(details: RepositoryDetails): Promise<void> {
    toast = { show: vi.fn() };
    cloneAnswers = [];
    cloneRequests = 0;
    credentials = () => of(sshKey());
    confirm = vi.fn().mockResolvedValue(true);
    unlockClosed = new Subject();
    open = vi.fn(() => ({ closed: unlockClosed }));
    store = { cloning: vi.fn(), reload: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [ CloneStatusComponent, translocoTesting() ],
      providers: [
        { provide: ToastService, useValue: toast },
        {
          provide: RepositoriesApi,
          useValue: {
            cloneAgain: (id: number) => {
              expect(id).toBe(7);
              cloneRequests++;
              return cloneAnswers.shift() ?? of(cloning());
            },
            repositoryCredentials: () => credentials()
          }
        },
        { provide: DialogService, useValue: { confirm, open } },
        { provide: RepositorySettingsStore, useValue: store }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(CloneStatusComponent);
    fixture.componentRef.setInput('details', details);
    await settle(fixture);
  }

  it('is a section named by its heading', async () => {
    await show(failed());

    const heading = host().querySelector('h2');
    expect(heading?.textContent?.trim()).toBe(`${KEY}.heading`);
    expect(host().querySelector('section')?.getAttribute('aria-labelledby')).toBe(heading?.id);
  });

  it('shows progress while cloning', async () => {
    await show(repositoryDetails({ status: 'cloning', clone: { jobId: 3, state: 'running', percent: 42 } }));

    expect(host().querySelector('ui-progress-bar')?.getAttribute('aria-valuenow')).toBe('42');
    expect(detailsButton()).toBeNull();
  });

  it('says it is waiting for other clones', async () => {
    await show(repositoryDetails({ status: 'cloning', clone: { jobId: 3, state: 'waiting', percent: null } }));

    expect(host().textContent).toContain(`${DETAIL}.waiting`);
    expect(host().querySelector('ui-progress-bar')).toBeNull();
  });

  it('shows the error\'s label', async () => {
    await show(failed());

    expect(host().querySelector('shell-repository-status-detail')?.textContent?.trim()).toBe(
      `${DETAIL}.error.clone-failed`
    );
  });

  it('keeps Details closed at first, and opens it', async () => {
    await show(failed());

    const button = detailsButton();
    expect(button?.textContent?.trim()).toBe(`${KEY}.details`);
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.getAttribute('aria-controls')).toBe(region()?.id);
    expect(region()?.hasAttribute('inert')).toBe(true);

    button?.click();
    await settle(fixture);

    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(region()?.hasAttribute('inert')).toBe(false);
  });

  it('closes Details when the repository leaves Error, and keeps it open while it stays', async () => {
    await show(failed());
    detailsButton()?.click();
    await settle(fixture);

    fixture.componentRef.setInput('details', failed({ errorRequestId: 'req-reloaded' }));
    await settle(fixture);
    expect(detailsButton()?.getAttribute('aria-expanded')).toBe('true');

    fixture.componentRef.setInput(
      'details',
      repositoryDetails({ status: 'cloning', clone: { jobId: 4, state: 'running', percent: null } })
    );
    await settle(fixture);
    fixture.componentRef.setInput('details', failed());
    await settle(fixture);

    expect(detailsButton()?.getAttribute('aria-expanded')).toBe('false');
    expect(region()?.hasAttribute('inert')).toBe(true);
  });

  it('shows git\'s error as text', async () => {
    await show(failed({ errorDetail: 'fatal: <img src=x onerror="alert(1)"> not found' }));

    expect(message()?.textContent).toBe('fatal: <img src=x onerror="alert(1)"> not found');
    expect(message()?.querySelector('img')).toBeNull();
  });

  it('shows the request ID with Copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await show(failed());

    expect(host().querySelector('.request')?.textContent).toContain(`${KEY}.requestId`);
    expect(host().querySelector('.request code')?.textContent).toBe('req-0123456789');
    expect(copyButton()?.getAttribute('aria-label')).toBe(`${KEY}.copyLabel`);

    copyButton()?.click();
    await settle(fixture);

    expect(writeText).toHaveBeenCalledWith('req-0123456789');
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ message: `${KEY}.copied`, status: 'success' }));
  });

  it('says when git recorded no message', async () => {
    await show(failed({ errorDetail: null, errorRequestId: null }));

    expect(message()).toBeNull();
    expect(host().querySelector('.no-message')?.textContent?.trim()).toBe(`${KEY}.noMessage`);
    expect(host().querySelector('.request')).toBeNull();
  });

  it('shows the request ID without a message', async () => {
    await show(failed({ errorDetail: null }));

    expect(host().querySelector('.no-message')).not.toBeNull();
    expect(host().querySelector('.request code')?.textContent).toBe('req-0123456789');
  });

  describe('Retry clone and Clone again', () => {
    const cloneButton = () => host().querySelector<HTMLButtonElement>('button.clone');
    const failureBanner = () => host().querySelector('ui-inline-banner.failure');
    const damaged = () => repositoryDetails({ status: 'error', error: 'working-copy-missing' });

    async function press(): Promise<void> {
      cloneButton()?.click();
      await settle(fixture);
    }

    it('offers Retry clone after a failed or timed out clone, with the credentials it uses', async () => {
      await show(repositoryDetails({ status: 'error', error: 'clone-timed-out' }));

      expect(cloneButton()?.textContent?.trim()).toBe(`${KEY}.retry`);
      expect(host().querySelector('.hint')?.textContent?.trim()).toBe(`${KEY}.retryHint`);
    });

    it('offers nothing while cloning', async () => {
      await show(repositoryDetails({ status: 'cloning', clone: { jobId: 3, state: 'running', percent: 10 } }));

      expect(cloneButton()).toBeNull();
    });

    it('retries without asking, and shows Cloning at once', async () => {
      await show(failed());

      await press();

      expect(confirm).not.toHaveBeenCalled();
      expect(cloneRequests).toBe(1);
      expect(store.cloning).toHaveBeenCalledWith(cloning());
      expect(cloneButton()?.getAttribute('aria-busy')).not.toBe('true');
    });

    it('warns before Clone again, then clones', async () => {
      await show(damaged());

      expect(cloneButton()?.textContent?.trim()).toBe(`${KEY}.cloneAgain`);
      expect(host().querySelector('.hint')).toBeNull();
      await press();

      expect(confirm).toHaveBeenCalledWith({
        heading: `${KEY}.confirm.heading`,
        message: `${KEY}.confirm.message`,
        confirmLabel: `${KEY}.confirm.confirm`,
        cancelLabel: `${KEY}.confirm.cancel`,
        variant: 'danger'
      });
      expect(cloneRequests).toBe(1);
      expect(store.cloning).toHaveBeenCalledWith(cloning());
    });

    it('unlocks the key first', async () => {
      await show(failed());
      cloneAnswers = [ keyLocked() ];

      await press();
      expect(open).toHaveBeenCalledWith(UnlockKeyDialog, {
        data: {
          id: 2,
          name: 'Laptop key',
          keyType: 'ed25519',
          fingerprint: 'SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
        }
      });
      expect(store.cloning).not.toHaveBeenCalled();

      unlockClosed.next(true);
      unlockClosed.complete();
      await settle(fixture);

      expect(cloneRequests).toBe(2);
      expect(store.cloning).toHaveBeenCalledWith(cloning());
      expect(failureBanner()).toBeNull();
    });

    it('sends again without asking when the key was unlocked meanwhile', async () => {
      await show(failed());
      cloneAnswers = [ keyLocked() ];
      credentials = () => of(sshKey(true));

      await press();

      expect(open).not.toHaveBeenCalled();
      expect(cloneRequests).toBe(2);
      expect(store.cloning).toHaveBeenCalled();
    });

    it('asks only once per press', async () => {
      await show(failed());
      cloneAnswers = [ keyLocked(), keyLocked() ];

      await press();
      unlockClosed.next(true);
      unlockClosed.complete();
      await settle(fixture);

      expect(open).toHaveBeenCalledTimes(1);
      expect(cloneRequests).toBe(2);
      // Without a text for `errors.key-locked`, the API's message.
      expect(failureBanner()?.textContent).toContain('locked');
      expect(failureBanner()?.querySelector('.reference code')?.textContent).toBe('req-2');
    });

    it('cancelling changes nothing', async () => {
      await show(damaged());
      confirm.mockResolvedValue(false);
      await press();

      expect(cloneRequests).toBe(0);

      confirm.mockResolvedValue(true);
      cloneAnswers = [ keyLocked() ];
      await press();
      unlockClosed.next(undefined);
      unlockClosed.complete();
      await settle(fixture);

      expect(cloneRequests).toBe(1);
      expect(store.cloning).not.toHaveBeenCalled();
      expect(failureBanner()).toBeNull();
      expect(cloneButton()?.getAttribute('aria-busy')).not.toBe('true');
    });

    it('sends one request', async () => {
      await show(failed());
      const answer = new Subject<RepositorySummary>();
      cloneAnswers = [ answer ];

      cloneButton()?.click();
      cloneButton()?.click();
      await settle(fixture);
      expect(cloneRequests).toBe(1);

      answer.next(cloning());
      answer.complete();
      await settle(fixture);

      expect(store.cloning).toHaveBeenCalledTimes(1);
    });

    it('shows a limit\'s refusal', async () => {
      await show(failed());
      cloneAnswers = [ throwError(() => apiFailure(429, 'too-many-jobs')) ];

      await press();

      expect(failureBanner()?.textContent).toContain('too-many-jobs');
      expect(failureBanner()?.querySelector('.reference code')?.textContent).toBe('req-1');
      expect(store.cloning).not.toHaveBeenCalled();
      expect(store.reload).not.toHaveBeenCalled();
    });

    it('reads the repository again when it was cloned elsewhere', async () => {
      await show(failed());
      cloneAnswers = [ throwError(() => apiFailure(409, 'repository-not-in-error')) ];

      await press();

      expect(store.reload).toHaveBeenCalled();
    });

    it('forgets a refusal once the repository leaves Error', async () => {
      await show(failed());
      cloneAnswers = [ throwError(() => apiFailure(429, 'rate-limited')) ];
      await press();
      expect(failureBanner()).not.toBeNull();

      fixture.componentRef.setInput('details', repositoryDetails({ status: 'cloning', clone: null }));
      await settle(fixture);
      fixture.componentRef.setInput('details', failed());
      await settle(fixture);

      expect(failureBanner()).toBeNull();
    });
  });

  it('is hidden for a ready repository', async () => {
    await show(repositoryDetails());

    expect(host().querySelector('section')).toBeNull();
    expect(host().classList).toContain('none');
  });
});
