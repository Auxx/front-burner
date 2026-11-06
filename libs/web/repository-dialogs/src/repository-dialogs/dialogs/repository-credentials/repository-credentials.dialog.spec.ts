import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type {
  GeneratedSshKey,
  RepositoryCredentialsInfo,
  RepositorySummary,
  SavedCredentials,
  SavedSshKey
} from '@front-burner/shared-contracts';
import { DialogRef, DialogService } from '@front-burner/ui';
import { CredentialsApi, KnownHostsApi, RepositoriesApi } from '@front-burner/web-api-client';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';

import { dialogButton, overlay, settleDialog } from '../../../testing/dialog-testing';
import { choose, control, radioLabels, selectValue, type } from '../../../testing/form-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RepositoryCredentialsDialog, type RepositoryCredentialsDialogData } from './repository-credentials.dialog';

const KEY = 'web-repository-dialogs.RepositoryCredentialsDialog';
const HTTPS = 'web-repository-dialogs.HttpsCredentialsComponent';
const SSH = 'web-repository-dialogs.SshCredentialsComponent';
const GENERATED = 'web-repository-dialogs.GeneratedKeyComponent';

const handbook: RepositorySummary = {
  id: 5,
  name: 'Handbook',
  remote: 'github.com/acme/handbook',
  status: 'ready',
  error: null,
  warnings: [],
  lastAccessedAt: '2026-11-01T10:00:00.000Z'
};

const laptop: SavedSshKey = {
  id: 3,
  name: 'laptop',
  keyType: 'ed25519',
  fingerprint: 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU',
  passphraseProtected: false,
  unlocked: false,
  generated: false,
  missing: false
};

const sshInUse: RepositoryCredentialsInfo = { protocol: 'ssh', inUse: { kind: 'ssh-key', ...laptop, usedBy: 1 } };
const sshWithout: RepositoryCredentialsInfo = { protocol: 'ssh', inUse: null };
const httpsWithout: RepositoryCredentialsInfo = { protocol: 'https', inUse: null };
const nothingSaved: SavedCredentials = { https: [], sshKeys: [] };

const hostKey = {
  host: 'git.example.com',
  port: 22,
  type: 'ssh-ed25519',
  key: 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
  fingerprint: 'SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8'
};

function failure(status: number, code: string, extra: Record<string, unknown> = {}): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: { code, params: {}, requestId: 'abcdef0123456789', message: code, ...extra }
  });
}

describe('RepositoryCredentialsDialog', () => {
  let ref: DialogRef<boolean>;
  let repositoriesApi: {
    repositoryCredentials: ReturnType<typeof vi.fn>;
    replaceRepositoryCredentials: ReturnType<typeof vi.fn>;
  };
  let credentialsApi: {
    list: ReturnType<typeof vi.fn>;
    generateSshKey: ReturnType<typeof vi.fn>;
    unlockSshKey: ReturnType<typeof vi.fn>;
  };
  let knownHostsApi: { trust: ReturnType<typeof vi.fn>; };

  /** The open dialog, or `null` once it closed. */
  const shown = () => overlay().querySelector<HTMLElement>('dlg-repository-credentials');
  /** The open dialog; fails the test if it is closed. */
  const dialog = (): HTMLElement => {
    const element = shown();
    if (element === null) {
      throw new Error('The dialog is not open');
    }
    return element;
  };
  const text = () => shown()?.textContent?.replace(/\s+/g, ' ') ?? '';

  async function open(data: Partial<RepositoryCredentialsDialogData> = {}): Promise<void> {
    ref = TestBed.inject(DialogService).open<RepositoryCredentialsDialog, RepositoryCredentialsDialogData, boolean>(
      RepositoryCredentialsDialog,
      { data: { repository: handbook, ...data } }
    );
    await settleDialog();
  }

  async function save(): Promise<void> {
    dialogButton(`${KEY}.save`)?.click();
    await settleDialog();
  }

  async function cancel(): Promise<void> {
    dialogButton(`${KEY}.cancel`)?.click();
    await settleDialog();
  }

  beforeEach(() => {
    repositoriesApi = {
      repositoryCredentials: vi.fn(() => of(httpsWithout)),
      replaceRepositoryCredentials: vi.fn(() => of(httpsWithout))
    };
    credentialsApi = {
      list: vi.fn(() => of(nothingSaved)),
      generateSshKey: vi.fn(),
      unlockSshKey: vi.fn(() => of(undefined))
    };
    knownHostsApi = { trust: vi.fn(() => of(undefined)) };
    TestBed.configureTestingModule({
      imports: [ translocoTesting({ 'errors.host-unreachable': '{{ host }} can\'t be reached.' }) ],
      providers: [
        { provide: RepositoriesApi, useValue: repositoriesApi },
        { provide: CredentialsApi, useValue: credentialsApi },
        { provide: KnownHostsApi, useValue: knownHostsApi }
      ]
    });
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('AC-REPO-002.7: an SSH repository offers only SSH choices, and a refused key shows the hint', async () => {
    repositoriesApi.repositoryCredentials.mockReturnValue(of(sshInUse));
    credentialsApi.list.mockReturnValue(of({ https: [], sshKeys: [ laptop ] }));

    await open({ hint: 'refused-key' });

    expect(radioLabels(dialog())).toEqual([
      `${SSH}.choices.saved`,
      `${SSH}.choices.new-ssh-key`,
      `${SSH}.choices.generate`
    ]);
    expect(text()).toContain(`${KEY}.refusedKey`);
    expect(repositoriesApi.repositoryCredentials).toHaveBeenCalledWith(5);
  });

  it('offers the HTTPS choices, with No credentials', async () => {
    await open({ hint: 'refused-key' });

    expect(radioLabels(dialog())).toEqual([ `${HTTPS}.choices.new-https`, `${HTTPS}.choices.none` ]);
    // The hint is about keys only (RC-14).
    expect(text()).not.toContain(`${KEY}.refusedKey`);
  });

  it('shows the repository and the credentials in use', async () => {
    repositoriesApi.repositoryCredentials.mockReturnValue(of(sshInUse));

    await open();

    const values = [ ...dialog().querySelectorAll('[uiKeyValue]') ].map(element => element.textContent ?? '');
    expect(values.some(value => value.includes('Handbook'))).toBe(true);
    expect(values.some(value => value.includes('github.com/acme/handbook'))).toBe(true);
    expect(values.some(value => value.includes('laptop'))).toBe(true);
    expect(values.some(value => value.includes(`${KEY}.keyTypes.ed25519`))).toBe(true);
    expect(values.some(value => value.includes(laptop.fingerprint))).toBe(true);
  });

  it('says when the repository has no credentials', async () => {
    await open();

    const values = [ ...dialog().querySelectorAll('[uiKeyValue]') ].map(element => element.textContent ?? '');
    expect(values.some(value => value.includes(`${KEY}.noCredentials`))).toBe(true);
  });

  it('says to make sure the credentials can push', async () => {
    await open();

    expect(text()).toContain(`${KEY}.canPush`);
  });

  it('saves the chosen credentials and closes with true', async () => {
    await open();
    const closed = firstValueFrom(ref.closed);
    choose(dialog(), `${HTTPS}.choices.none`);
    await settleDialog();

    await save();

    expect(repositoriesApi.replaceRepositoryCredentials).toHaveBeenCalledWith(5, { mode: 'none' });
    expect(await closed).toBe(true);
  });

  it('Save is unavailable until the form is complete, as on the Add repository page', async () => {
    await open();

    expect(dialogButton(`${KEY}.save`)?.getAttribute('aria-disabled')).toBe('true');
    await save();

    expect(repositoriesApi.replaceRepositoryCredentials).not.toHaveBeenCalled();
    expect(shown()).not.toBeNull();
  });

  it('Save waits while a key is being generated', async () => {
    const generated = new Subject<GeneratedSshKey>();
    repositoriesApi.repositoryCredentials.mockReturnValue(of(sshWithout));
    credentialsApi.list.mockReturnValue(of({ https: [], sshKeys: [ laptop ] }));
    credentialsApi.generateSshKey.mockReturnValue(generated);
    await open();
    expect(dialogButton(`${KEY}.save`)?.getAttribute('aria-disabled')).toBeNull();
    choose(dialog(), `${SSH}.choices.generate`);
    await settleDialog();
    type(control(dialog(), `${GENERATED}.name`), 'front-burner');
    await settleDialog();
    dialogButton(`${GENERATED}.generate`)?.click();
    await settleDialog();
    choose(dialog(), `${SSH}.choices.saved`);
    await settleDialog();

    expect(dialogButton(`${KEY}.save`)?.getAttribute('aria-disabled')).toBe('true');
    generated.complete();
  });

  it('shows a failed check as on the Add repository page, and stays open', async () => {
    repositoriesApi.replaceRepositoryCredentials.mockReturnValueOnce(
      throwError(() =>
        failure(422, 'validation-failed', {
          fields: [ { path: 'credentials', code: 'credentials-refused', params: {} } ]
        })
      )
    );
    await open();
    choose(dialog(), `${HTTPS}.choices.none`);
    await settleDialog();

    await save();

    expect(text()).toContain('web-repository-dialogs.errors.credentials.credentials-refused');
    expect(shown()).not.toBeNull();

    repositoriesApi.replaceRepositoryCredentials.mockReturnValueOnce(
      throwError(() =>
        failure(422, 'validation-failed', {
          fields: [ { path: 'remoteUrl', code: 'host-unreachable', params: { host: 'github.com' } } ]
        })
      )
    );
    await save();

    expect(dialog().querySelector('ui-inline-banner[status="danger"]')?.textContent).toContain(
      'github.com can\'t be reached.'
    );
    expect(shown()).not.toBeNull();
  });

  it('shows progress on Save, and cannot be closed until the check answers', async () => {
    const answer = new Subject<RepositoryCredentialsInfo>();
    repositoriesApi.replaceRepositoryCredentials.mockReturnValue(answer);
    await open();
    const closed = firstValueFrom(ref.closed);
    choose(dialog(), `${HTTPS}.choices.none`);
    await settleDialog();

    await save();
    expect(dialogButton(`${KEY}.save`)?.getAttribute('aria-disabled')).toBe('true');
    // The backend may already use the new credentials when it answers: the push must then run again (RC-9).
    expect(dialogButton(`${KEY}.cancel`)?.getAttribute('aria-disabled')).toBe('true');
    expect(ref.dismissible()).toBe(false);
    await cancel();
    expect(shown()).not.toBeNull();

    answer.next(httpsWithout);
    answer.complete();
    await settleDialog();

    expect(await closed).toBe(true);
  });

  it('can be closed again once a check failed', async () => {
    repositoriesApi.replaceRepositoryCredentials.mockReturnValueOnce(throwError(() => failure(500, 'internal')));
    await open();
    const closed = firstValueFrom(ref.closed);
    choose(dialog(), `${HTTPS}.choices.none`);
    await settleDialog();
    await save();

    expect(ref.dismissible()).toBe(true);
    await cancel();

    expect(await closed).toBeUndefined();
    expect(repositoriesApi.replaceRepositoryCredentials).toHaveBeenCalledOnce();
  });

  it('does not choose the credentials in use, which failed, by default', async () => {
    const readOnly = { id: 4, name: 'read only', username: 'reader', missing: false };
    const writer = { id: 6, name: 'writer', username: 'writer', missing: false };
    repositoriesApi.repositoryCredentials.mockReturnValue(of(
      {
        protocol: 'https',
        inUse: { kind: 'https', ...readOnly, usedBy: 1 }
      } satisfies RepositoryCredentialsInfo
    ));
    credentialsApi.list.mockReturnValue(of({ https: [ readOnly, writer ], sshKeys: [] }));

    await open();

    expect(selectValue(dialog(), `${HTTPS}.saved`)).toContain('writer');
  });

  it('offers new credentials by default when the only saved ones are those in use', async () => {
    repositoriesApi.repositoryCredentials.mockReturnValue(of(sshInUse));
    credentialsApi.list.mockReturnValue(of({ https: [], sshKeys: [ laptop ] }));

    await open();

    const checked = dialog().querySelector<HTMLInputElement>('input[type=radio]:checked');
    expect(checked?.closest('label')?.textContent?.trim()).toBe(`${SSH}.choices.new-ssh-key`);
    expect(radioLabels(dialog())).toContain(`${SSH}.choices.saved`);
  });

  it('asks to trust an unknown host, and checks again', async () => {
    repositoriesApi.repositoryCredentials.mockReturnValue(of(sshWithout));
    credentialsApi.list.mockReturnValue(of({ https: [], sshKeys: [ laptop ] }));
    repositoriesApi.replaceRepositoryCredentials
      .mockReturnValueOnce(throwError(() => failure(502, 'host-key-unknown', { params: hostKey })))
      .mockReturnValueOnce(of(sshInUse));
    await open();
    const closed = firstValueFrom(ref.closed);

    await save();
    expect(overlay().querySelector('dlg-trust-host')).not.toBeNull();
    dialogButton('web-repository-dialogs.TrustHostDialog.trust')?.click();
    await settleDialog();

    expect(knownHostsApi.trust).toHaveBeenCalledWith({
      host: hostKey.host,
      port: hostKey.port,
      type: hostKey.type,
      key: hostKey.key
    });
    expect(repositoriesApi.replaceRepositoryCredentials).toHaveBeenCalledTimes(2);
    expect(repositoriesApi.replaceRepositoryCredentials).toHaveBeenLastCalledWith(5, {
      mode: 'saved',
      credentialId: 3
    });
    expect(await closed).toBe(true);
  });

  it('a generated key is in the saved keys when the dialog is opened again', async () => {
    const generated: GeneratedSshKey = {
      key: { ...laptop, id: 9, name: 'front-burner', generated: true },
      publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqq front-burner'
    };
    repositoriesApi.repositoryCredentials.mockReturnValue(of(sshInUse));
    credentialsApi.generateSshKey.mockReturnValue(of(generated));
    await open();
    choose(dialog(), `${SSH}.choices.generate`);
    await settleDialog();
    type(control(dialog(), `${GENERATED}.name`), 'front-burner');
    await settleDialog();
    dialogButton(`${GENERATED}.generate`)?.click();
    await settleDialog();

    // The public key, to add on the git server before the access check can pass (AR-29).
    expect((control(dialog(), `${GENERATED}.publicKey`) as HTMLTextAreaElement).value).toBe(generated.publicKey);

    await cancel();
    credentialsApi.list.mockReturnValue(of({ https: [], sshKeys: [ generated.key ] }));
    await open();

    expect(radioLabels(dialog())).toContain(`${SSH}.choices.saved`);
    expect(selectValue(dialog(), `${SSH}.saved`)).toContain('front-burner');
  });

  it('opening the dialog again starts empty', async () => {
    await open();
    type(control(dialog(), `${HTTPS}.username`), 'ada');
    type(control(dialog(), `${HTTPS}.password`), 'ghp_secret');
    await settleDialog();
    await cancel();

    await open();

    expect(control(dialog(), `${HTTPS}.username`).value).toBe('');
    expect(control(dialog(), `${HTTPS}.password`).value).toBe('');
  });

  it('moves focus to the first field, and returns it on closing', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    await open();

    const first = dialog().querySelector('input');
    expect(document.activeElement).toBe(first);

    await cancel();

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('shows why it could not read the repository\'s credentials', async () => {
    repositoriesApi.repositoryCredentials.mockReturnValue(throwError(() => failure(500, 'internal')));

    await open();

    expect(dialog().querySelector('ui-inline-banner[status="danger"]')).not.toBeNull();
    expect(dialogButton(`${KEY}.save`)?.getAttribute('aria-disabled')).toBe('true');
  });
});
