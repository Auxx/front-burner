import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { PushEvent, RepositoryCredentialsInfo, RepositorySummary } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { PushChannelService } from '@front-burner/web-core';
import { RepositoryCredentialsDialog } from '@front-burner/web-repository-dialogs';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { apiFailure } from '../../../testing/api-failure';
import { repositoryDetails } from '../../../testing/repository-details';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RepositorySettingsStore } from '../../services/repository-settings-store/repository-settings-store.service';
import { CredentialsInUseComponent } from './credentials-in-use.component';

const KEY = 'web-feature-repositories.CredentialsInUseComponent';

type InUse = NonNullable<RepositoryCredentialsInfo['inUse']>;

const httpsInUse: InUse = {
  kind: 'https',
  id: 1,
  name: 'GitHub token',
  username: 'octocat',
  missing: false,
  usedBy: 2
};
const https: RepositoryCredentialsInfo = { protocol: 'https', inUse: httpsInUse };

const sshKeyInUse = {
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
} satisfies InUse;
const sshKey: RepositoryCredentialsInfo = { protocol: 'ssh', inUse: sshKeyInUse };

const publicRepository: RepositoryCredentialsInfo = { protocol: 'https', inUse: null };

describe('CredentialsInUseComponent', () => {
  let fixture: ComponentFixture<CredentialsInUseComponent>;
  let answers: (() => Observable<RepositoryCredentialsInfo>)[];
  let requested: number[];
  let open: ReturnType<typeof vi.fn>;
  let closed: Subject<boolean | undefined>;
  let store: { reload: ReturnType<typeof vi.fn>; };
  let push: { events: Subject<PushEvent>; reconnected: Subject<void>; };

  const host = () => fixture.nativeElement as HTMLElement;
  const changeButton = () => host().querySelector<HTMLButtonElement>('button.change');

  async function show(repository: RepositorySummary, ...replies: (() => Observable<RepositoryCredentialsInfo>)[]) {
    answers = replies;
    requested = [];
    closed = new Subject();
    open = vi.fn(() => ({ closed }));
    store = { reload: vi.fn() };
    push = { events: new Subject(), reconnected: new Subject() };
    await TestBed.configureTestingModule({
      imports: [
        CredentialsInUseComponent,
        translocoTesting({
          [`${KEY}.kinds.https`]: 'HTTPS credentials',
          [`${KEY}.kinds.ssh-key`]: 'SSH key',
          [`${KEY}.keyTypes.ed25519`]: 'Ed25519',
          [`${KEY}.protected`]: 'Protected',
          [`${KEY}.none`]: 'None'
        })
      ],
      providers: [
        {
          provide: RepositoriesApi,
          useValue: {
            repositoryCredentials: (id: number) => {
              requested.push(id);
              return (answers.shift() ?? (() => of(publicRepository)))();
            }
          }
        },
        { provide: DialogService, useValue: { open } },
        { provide: RepositorySettingsStore, useValue: store },
        { provide: PushChannelService, useValue: push }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(CredentialsInUseComponent);
    fixture.componentRef.setInput('repository', repository);
    await settle(fixture);
  }

  /** Each label with its value, as the key-value list shows them. */
  function values(): Record<string, string> {
    return Object.fromEntries(
      [ ...host().querySelectorAll('div[uikeyvalue]') ].map(item => [
        item.querySelector('dt')?.textContent?.trim(),
        item.querySelector('dd')?.textContent?.replace(/\s+/g, ' ').trim()
      ])
    );
  }

  const ready = () => repositoryDetails().summary;

  it('is a section named by its heading', async () => {
    await show(ready(), () => of(https));

    const heading = host().querySelector('h2');
    expect(heading?.textContent?.trim()).toBe(`${KEY}.heading`);
    expect(host().querySelector('section')?.getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(requested).toEqual([ 7 ]);
  });

  it('shows HTTPS credentials with the username', async () => {
    await show(ready(), () => of(https));

    expect(values()).toEqual({
      [`${KEY}.name`]: 'GitHub token',
      [`${KEY}.kind`]: 'HTTPS credentials',
      [`${KEY}.username`]: 'octocat'
    });
  });

  it('shows an SSH key with its type, fingerprint and passphrase', async () => {
    await show(ready(), () => of(sshKey));

    expect(values()).toEqual({
      [`${KEY}.name`]: 'Laptop key',
      [`${KEY}.kind`]: 'SSH key',
      [`${KEY}.keyType`]: 'Ed25519',
      [`${KEY}.fingerprint`]: 'SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
      [`${KEY}.passphrase`]: 'Protected'
    });
    // In the code font, which wraps on a phone.
    expect(host().querySelector('div[uikeyvalue][data-mono]')?.textContent).toContain('SHA256:');
  });

  it('shows a key without a passphrase', async () => {
    await show(ready(), () => of({ ...sshKey, inUse: { ...sshKeyInUse, passphraseProtected: false } }));

    expect(values()[`${KEY}.passphrase`]).toBe('None');
  });

  it('shows a public repository', async () => {
    await show(ready(), () => of(publicRepository));

    expect(host().querySelector('dl')).toBeNull();
    expect(host().textContent).toContain(`${KEY}.noCredentials`);
    expect(changeButton()).not.toBeNull();
  });

  it('never shows a secret', async () => {
    // Even if an answer held one, the section shows only the fields it names.
    const leaky: RepositoryCredentialsInfo = {
      protocol: 'https',
      inUse: Object.assign({}, httpsInUse, {
        password: 'ghp_secret-token',
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----'
      })
    };
    await show(ready(), () => of(leaky));

    expect(host().innerHTML).not.toContain('ghp_secret-token');
    expect(host().innerHTML).not.toContain('PRIVATE KEY');
  });

  it('opens the repository credentials dialog', async () => {
    const repository = ready();
    await show(repository, () => of(https));

    changeButton()?.click();
    await settle(fixture);

    expect(open).toHaveBeenCalledExactlyOnceWith(RepositoryCredentialsDialog, { data: { repository } });
  });

  it('opens one dialog for two quick presses', async () => {
    await show(ready(), () => of(https));

    changeButton()?.click();
    changeButton()?.click();
    await settle(fixture);

    expect(open).toHaveBeenCalledOnce();
  });

  it('shows the new credentials after saving', async () => {
    await show(ready(), () => of(https), () => of(sshKey));

    const changed = fixture.componentInstance.change();
    closed.next(true);
    closed.complete();

    await expect(changed).resolves.toBe(true);
    await settle(fixture);
    expect(requested).toEqual([ 7, 7 ]);
    expect(values()[`${KEY}.name`]).toBe('Laptop key');
    // The warnings may have changed with the credentials.
    expect(store.reload).toHaveBeenCalledOnce();
  });

  it('cancelling changes nothing', async () => {
    await show(ready(), () => of(https));

    const changed = fixture.componentInstance.change();
    closed.complete();

    await expect(changed).resolves.toBe(false);
    await settle(fixture);
    expect(requested).toEqual([ 7 ]);
    expect(store.reload).not.toHaveBeenCalled();
    expect(values()[`${KEY}.name`]).toBe('GitHub token');
  });

  it('passes the options of a fix to the dialog', async () => {
    const repository = ready();
    await show(repository, () => of(https));

    void fixture.componentInstance.change({ offerTokenUpdate: true });

    expect(open).toHaveBeenCalledWith(RepositoryCredentialsDialog, {
      data: { repository, offerTokenUpdate: true }
    });
  });

  it('offers Change credentials for a failed clone', async () => {
    await show(repositoryDetails({ status: 'error', error: 'clone-failed' }).summary, () => of(https));

    expect(changeButton()?.textContent?.trim()).toBe(`${KEY}.change`);
    expect(changeButton()?.disabled).toBe(false);
  });

  it('offers Change credentials while cloning', async () => {
    await show(
      repositoryDetails({ status: 'cloning', clone: { jobId: 3, state: 'running', percent: 10 } }).summary,
      () => of(https)
    );

    expect(changeButton()).not.toBeNull();
  });

  it('offers Try again when the credentials could not be loaded', async () => {
    await show(ready(), () => throwError(() => apiFailure(500, 'internal')), () => of(https));
    expect(host().textContent).toContain(`${KEY}.loadFailed`);

    host().querySelector<HTMLButtonElement>('button.retry')?.click();
    await settle(fixture);

    expect(values()[`${KEY}.name`]).toBe('GitHub token');
  });

  it('does not read again when only the summary changes', async () => {
    await show(ready(), () => of(https));

    fixture.componentRef.setInput('repository', { ...ready(), status: 'error', error: 'clone-failed' });
    await settle(fixture);

    expect(requested).toEqual([ 7 ]);
  });

  it('says when the saved credentials are no longer available', async () => {
    await show(ready(), () => of({ ...https, inUse: { ...httpsInUse, missing: true } }));

    expect(host().querySelector('ui-inline-banner.missing')?.textContent?.trim()).toBe(`${KEY}.missing`);
    expect(values()[`${KEY}.name`]).toBe('GitHub token');
  });

  it('says nothing more of credentials that are available', async () => {
    await show(ready(), () => of(sshKey));

    expect(host().querySelector('ui-inline-banner')).toBeNull();
  });

  it('shows credentials changed elsewhere after the repository\'s event', async () => {
    await show(ready(), () => of(https), () => of(sshKey));

    push.events.next({ type: 'repository.warning', repositoryId: 7 });
    await settle(fixture);

    expect(requested).toEqual([ 7, 7 ]);
    expect(values()[`${KEY}.name`]).toBe('Laptop key');
  });

  it('reads again on the repository\'s status, and not on another repository\'s events', async () => {
    await show(ready(), () => of(https));

    push.events.next({ type: 'repository.warning', repositoryId: 8 });
    push.events.next({ type: 'repository.status', repositoryId: 8, status: 'ready', error: null });
    push.events.next({ type: 'job.progress', jobId: 3, percent: 10 });
    await settle(fixture);
    expect(requested).toEqual([ 7 ]);

    push.events.next({ type: 'repository.status', repositoryId: 7, status: 'error', error: 'clone-failed' });
    await settle(fixture);
    expect(requested).toEqual([ 7, 7 ]);
  });

  it('reads again after a reconnect, keeping what it shows when that fails', async () => {
    await show(ready(), () => of(https), () => throwError(() => apiFailure(500, 'internal')));

    push.reconnected.next();
    await settle(fixture);

    expect(requested).toEqual([ 7, 7 ]);
    expect(values()[`${KEY}.name`]).toBe('GitHub token');
    expect(host().textContent).not.toContain(`${KEY}.loadFailed`);
  });

  it('is busy while the dialog is open', async () => {
    await show(ready(), () => of(https));

    changeButton()?.click();
    await settle(fixture);
    expect(changeButton()?.getAttribute('aria-disabled')).toBe('true');

    closed.complete();
    await settle(fixture);
    expect(changeButton()?.getAttribute('aria-disabled')).toBeNull();
  });

  it('answers a second call as the open dialog does', async () => {
    await show(ready(), () => of(https), () => of(sshKey));

    const first = fixture.componentInstance.change();
    const second = fixture.componentInstance.change({ offerTokenUpdate: true });
    closed.next(true);
    closed.complete();

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(open).toHaveBeenCalledOnce();
    expect(store.reload).toHaveBeenCalledOnce();
  });

  it('opens the dialog again once the first one has closed', async () => {
    await show(ready(), () => of(https));

    const first = fixture.componentInstance.change();
    closed.complete();
    await first;
    closed = new Subject();
    void fixture.componentInstance.change();

    expect(open).toHaveBeenCalledTimes(2);
  });

  it('reads nothing after the page has gone', async () => {
    await show(ready(), () => of(https));

    const changed = fixture.componentInstance.change();
    fixture.destroy();
    closed.next(true);
    closed.complete();

    await expect(changed).resolves.toBe(true);
    expect(requested).toEqual([ 7 ]);
    expect(store.reload).not.toHaveBeenCalled();
  });

  it('leaves a repository that is gone to the page', async () => {
    await show(ready(), () => throwError(() => apiFailure(404, 'not-found')));

    expect(store.reload).toHaveBeenCalledOnce();
    expect(host().textContent).not.toContain(`${KEY}.loadFailed`);
    expect(host().querySelector('button.retry')).toBeNull();
  });
});
