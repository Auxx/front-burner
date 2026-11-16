import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { RepositoryCredentialsInfo, RepositoryDetails, RepositoryWarning } from '@front-burner/shared-contracts';
import { DialogService, ToastService } from '@front-burner/ui';
import { GitApi, RepositoriesApi } from '@front-burner/web-api-client';
import { ChangedHostKeyDialog, UnlockKeyDialog } from '@front-burner/web-repository-dialogs';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { apiFailure } from '../../../testing/api-failure';
import { repositoryDetails } from '../../../testing/repository-details';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RepositorySettingsStore } from '../../services/repository-settings-store/repository-settings-store.service';
import type { CredentialsInUseComponent } from '../credentials-in-use/credentials-in-use.component';
import { RepositoryWarningsComponent } from './repository-warnings.component';

const KEY = 'web-feature-repositories.RepositoryWarningsComponent';

const lockedKey: RepositoryCredentialsInfo = {
  protocol: 'ssh',
  inUse: {
    kind: 'ssh-key',
    id: 2,
    name: 'Laptop key',
    keyType: 'ed25519',
    fingerprint: 'SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
    passphraseProtected: true,
    unlocked: false,
    generated: false,
    missing: false,
    usedBy: 1
  }
};

const changedKey = {
  code: 'host-key-changed',
  params: {
    host: 'github.com',
    port: '22',
    type: 'ssh-ed25519',
    key: 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
    fingerprint: 'SHA256:new-fingerprint',
    trustedType: 'ssh-ed25519',
    trustedFingerprint: 'SHA256:old-fingerprint'
  }
};
/** The stored params as the dialog takes them: the port, stored as text, is a number. */
const shownKey = { ...changedKey.params, port: 22 };

describe('RepositoryWarningsComponent', () => {
  let fixture: ComponentFixture<RepositoryWarningsComponent>;
  let closed: Subject<boolean | undefined>;
  let open: ReturnType<typeof vi.fn>;
  let change: ReturnType<typeof vi.fn>;
  let changeAnswer: Subject<boolean>;
  let fetch: ReturnType<typeof vi.fn>;
  let credentials: () => Observable<RepositoryCredentialsInfo>;
  let store: { reload: ReturnType<typeof vi.fn>; };
  let toast: { show: ReturnType<typeof vi.fn>; };

  const host = () => fixture.nativeElement as HTMLElement;
  const lines = () =>
    [ ...host().querySelectorAll('ui-inline-banner') ].map(banner => ({
      text: banner.querySelector('.message')?.textContent?.trim(),
      fix: banner.querySelector('button')?.textContent?.trim()
    }));
  const fixButton = (index = 0) => host().querySelectorAll<HTMLButtonElement>('ui-inline-banner button')[index];

  async function show(details: RepositoryDetails): Promise<void> {
    closed = new Subject();
    open = vi.fn(() => ({ closed }));
    changeAnswer = new Subject();
    change = vi.fn(() => new Promise<boolean>(resolve => changeAnswer.subscribe(resolve)));
    fetch = vi.fn(() => of({ jobId: 3 }));
    credentials = () => of(lockedKey);
    store = { reload: vi.fn() };
    toast = { show: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [ RepositoryWarningsComponent, translocoTesting() ],
      providers: [
        { provide: DialogService, useValue: { open } },
        { provide: GitApi, useValue: { fetch } },
        { provide: RepositoriesApi, useValue: { repositoryCredentials: () => credentials() } },
        { provide: RepositorySettingsStore, useValue: store },
        { provide: ToastService, useValue: toast }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(RepositoryWarningsComponent);
    fixture.componentRef.setInput('details', details);
    fixture.componentRef.setInput('credentials', { change } as unknown as CredentialsInUseComponent);
    await settle(fixture);
  }

  const withWarnings = (warnings: RepositoryWarning[], extra: Partial<Omit<RepositoryDetails, 'summary'>> = {}) =>
    repositoryDetails({ warnings }, extra);

  async function press(index = 0): Promise<void> {
    fixButton(index).click();
    await settle(fixture);
  }

  it('shows nothing without warnings', async () => {
    await show(withWarnings([]));

    expect(host().querySelector('section')).toBeNull();
    expect(host().classList).toContain('none');
  });

  it('offers each warning\'s fix', async () => {
    await show(withWarnings([ 'credentials-refused', 'cannot-push', 'host-key-changed', 'key-locked' ]));

    expect(host().querySelector('section')?.getAttribute('aria-labelledby')).toBe(host().querySelector('h2')?.id);
    expect(lines()).toEqual([
      { text: `${KEY}.messages.credentials-refused`, fix: `${KEY}.fixes.credentials-refused` },
      { text: `${KEY}.messages.cannot-push`, fix: `${KEY}.fixes.cannot-push` },
      { text: `${KEY}.messages.host-key-changed`, fix: `${KEY}.fixes.host-key-changed` },
      { text: `${KEY}.messages.key-locked`, fix: `${KEY}.fixes.key-locked` }
    ]);
    // Colour is not the only signal: each line has the warning's icon (NF-13.7).
    expect(host().querySelectorAll('ui-inline-banner[data-status="warning"] ui-status-icon')).toHaveLength(4);
  });

  it('fixes refused credentials in the dialog\'s RC-12 mode, then fetches', async () => {
    await show(withWarnings([ 'credentials-refused' ]));

    await press();
    expect(change).toHaveBeenCalledWith({ hint: 'refused-key', offerTokenUpdate: true });
    expect(fixButton().hasAttribute('data-busy')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();

    changeAnswer.next(true);
    await settle(fixture);

    expect(fetch).toHaveBeenCalledWith(7);
    expect(fixButton().hasAttribute('data-busy')).toBe(false);
  });

  it('uses other credentials without fetching, as only a push or the change clears the warning', async () => {
    await show(withWarnings([ 'cannot-push' ]));

    await press();
    changeAnswer.next(true);
    await settle(fixture);

    expect(change).toHaveBeenCalledWith({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the new key from the stored problem', async () => {
    await show(withWarnings([ 'host-key-changed' ], { remoteProblems: { fetch: changedKey, push: null } }));

    await press();

    expect(open).toHaveBeenCalledWith(ChangedHostKeyDialog, { data: shownKey });
  });

  it('shows the new key of a push\'s problem', async () => {
    await show(withWarnings([ 'host-key-changed' ], { remoteProblems: { fetch: null, push: changedKey } }));

    await press();

    expect(open).toHaveBeenCalledWith(ChangedHostKeyDialog, { data: shownKey });
  });

  it('fetches after a fix', async () => {
    await show(withWarnings([ 'host-key-changed' ], { remoteProblems: { fetch: changedKey, push: null } }));

    await press();
    closed.next(true);
    closed.complete();
    await settle(fixture);

    expect(fetch).toHaveBeenCalledWith(7);
    expect(store.reload).toHaveBeenCalled();
  });

  it('unlocks the repository\'s key, then fetches', async () => {
    await show(withWarnings([ 'key-locked' ]));

    await press();
    expect(open).toHaveBeenCalledWith(UnlockKeyDialog, {
      data: {
        id: 2,
        name: 'Laptop key',
        keyType: 'ed25519',
        fingerprint: 'SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
      }
    });

    closed.next(true);
    closed.complete();
    await settle(fixture);

    expect(fetch).toHaveBeenCalledWith(7);
    expect(store.reload).toHaveBeenCalled();
  });

  it('fetches without asking when the key was unlocked meanwhile', async () => {
    await show(withWarnings([ 'key-locked' ]));
    credentials = () => of({ ...lockedKey, inUse: { ...lockedKey.inUse, unlocked: true } as typeof lockedKey.inUse });

    await press();

    expect(open).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(7);
  });

  it('says why when the key cannot be read', async () => {
    await show(withWarnings([ 'key-locked' ]));
    credentials = () => throwError(() => apiFailure(500, 'internal'));

    await press();

    expect(open).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ status: 'danger' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancelling a fix changes nothing', async () => {
    await show(withWarnings([ 'credentials-refused', 'host-key-changed', 'key-locked' ], {
      remoteProblems: { fetch: changedKey, push: null }
    }));

    await press(0);
    changeAnswer.next(false);
    await settle(fixture);
    for (const index of [ 1, 2 ]) {
      await press(index);
      closed.next(undefined);
      closed.complete();
      closed = new Subject();
      await settle(fixture);
    }

    expect(open).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(store.reload).not.toHaveBeenCalled();
  });

  it('runs one fix at a time', async () => {
    await show(withWarnings([ 'credentials-refused', 'cannot-push' ]));

    await press(0);
    await press(1);
    await press(0);

    expect(change).toHaveBeenCalledTimes(1);
  });

  it('keeps the warning when the fetch is refused', async () => {
    await show(withWarnings([ 'credentials-refused' ]));
    fetch.mockReturnValue(throwError(() => apiFailure(409, 'key-locked')));

    await press();
    changeAnswer.next(true);
    await settle(fixture);

    expect(fetch).toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
  });
});
