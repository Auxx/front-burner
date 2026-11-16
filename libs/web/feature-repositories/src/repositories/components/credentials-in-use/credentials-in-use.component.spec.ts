import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { RepositoryCredentialsInfo, RepositorySummary } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
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

  const host = () => fixture.nativeElement as HTMLElement;
  const changeButton = () => host().querySelector<HTMLButtonElement>('button.change');

  async function show(repository: RepositorySummary, ...replies: (() => Observable<RepositoryCredentialsInfo>)[]) {
    answers = replies;
    requested = [];
    closed = new Subject();
    open = vi.fn(() => ({ closed }));
    store = { reload: vi.fn() };
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
        { provide: RepositorySettingsStore, useValue: store }
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

  it('reads the credentials of another repository', async () => {
    await show(ready(), () => of(https), () => of(sshKey));

    fixture.componentRef.setInput('repository', { ...ready(), id: 8 });
    await settle(fixture);

    expect(requested).toEqual([ 7, 8 ]);
    expect(values()[`${KEY}.name`]).toBe('Laptop key');
  });

  it('does not read again when only the status changes', async () => {
    await show(ready(), () => of(https));

    fixture.componentRef.setInput('repository', { ...ready(), status: 'error', error: 'clone-failed' });
    await settle(fixture);

    expect(requested).toEqual([ 7 ]);
  });
});
