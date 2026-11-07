import { TestBed } from '@angular/core/testing';
import type { ChangedHostKey } from '@front-burner/shared-contracts';
import { DialogRef, DialogService } from '@front-burner/ui';
import { KnownHostsApi } from '@front-burner/web-api-client';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';

import { apiError, dialogButton, overlay, settleDialog } from '../../../testing/dialog-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { ChangedHostKeyDialog } from './changed-host-key.dialog';

const KEY = 'web-repository-dialogs.ChangedHostKeyDialog';

const changed: ChangedHostKey = {
  host: 'git.example.com',
  port: 2222,
  type: 'ssh-ed25519',
  key: 'AAAAC3NzaC1lZDI1NTE5AAAAIH',
  fingerprint: 'SHA256:newfingerprint',
  trustedType: 'ssh-rsa',
  trustedFingerprint: 'SHA256:trustedfingerprint'
};

describe('ChangedHostKeyDialog', () => {
  let ref: DialogRef<boolean>;
  let api: { replace: ReturnType<typeof vi.fn>; };

  const checkbox = () => overlay().querySelector<HTMLInputElement>('input[type=checkbox]');
  const trust = () => dialogButton(`${KEY}.trust`);
  const values = () => [ ...overlay().querySelectorAll('[uiKeyValue]') ].map(element => element.textContent ?? '');
  const links = () => [ ...overlay().querySelectorAll<HTMLAnchorElement>('a[href]') ];

  async function open(data: ChangedHostKey = changed): Promise<void> {
    ref = TestBed.inject(DialogService).open<ChangedHostKeyDialog, ChangedHostKey, boolean>(ChangedHostKeyDialog, {
      data
    });
    await settleDialog();
  }

  async function tick(): Promise<void> {
    checkbox()?.click();
    await settleDialog();
  }

  beforeEach(() => {
    api = { replace: vi.fn(() => of(undefined)) };
    TestBed.configureTestingModule({
      imports: [ translocoTesting() ],
      providers: [ { provide: KnownHostsApi, useValue: api } ]
    });
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('says that the server\'s identity changed, and that this may be an attack', async () => {
    await open();

    expect(overlay().querySelector('h2')?.textContent).toContain(`${KEY}.heading`);
    expect(overlay().textContent).toContain(`${KEY}.explanation`);
  });

  it('shows both fingerprints, and the host and port', async () => {
    await open();

    expect(values().some(text => text.includes('git.example.com:2222'))).toBe(true);
    const trusted = values().find(text => text.includes(`${KEY}.trustedKey`));
    expect(trusted).toContain('ssh-rsa');
    expect(trusted).toContain('SHA256:trustedfingerprint');
    const fresh = values().find(text => text.includes(`${KEY}.newKey`));
    expect(fresh).toContain('ssh-ed25519');
    expect(fresh).toContain('SHA256:newfingerprint');
    const fingerprints = [ ...overlay().querySelectorAll('code.fingerprint') ].map(code => code.textContent?.trim());
    expect(fingerprints).toEqual([ 'SHA256:trustedfingerprint', 'SHA256:newfingerprint' ]);
  });

  it('leaves out the standard SSH port', async () => {
    await open({ ...changed, port: 22 });

    expect(values().some(text => text.includes('git.example.com'))).toBe(true);
    expect(values().some(text => text.includes(':22'))).toBe(false);
  });

  it('puts an IPv6 address in brackets before its port', async () => {
    await open({ ...changed, host: 'fd00::1' });

    expect(values().some(text => text.includes('[fd00::1]:2222'))).toBe(true);
  });

  it('shows an IPv6 address on the standard port without brackets', async () => {
    await open({ ...changed, host: 'fd00::1', port: 22 });

    expect(values().find(text => text.includes(`${KEY}.host`))?.replace(`${KEY}.host`, '').trim()).toBe('fd00::1');
  });

  it('says when the trusted key is not known by name', async () => {
    await open({ ...changed, trustedType: undefined, trustedFingerprint: undefined });

    expect(values().find(text => text.includes(`${KEY}.trustedKey`))).toContain(`${KEY}.trustedUnknown`);
  });

  it('Trust is disabled until the checkbox is ticked', async () => {
    await open();

    expect(trust()?.getAttribute('aria-disabled')).toBe('true');
    trust()?.click();
    await settleDialog();
    expect(api.replace).not.toHaveBeenCalled();

    await tick();

    expect(trust()?.getAttribute('aria-disabled')).toBeNull();
  });

  it('replaces the trusted key with the new one, and closes with true', async () => {
    await open();
    const closed = firstValueFrom(ref.closed);
    await tick();

    trust()?.click();

    expect(await closed).toBe(true);
    expect(api.replace).toHaveBeenCalledWith({
      host: 'git.example.com',
      port: 2222,
      type: 'ssh-ed25519',
      key: 'AAAAC3NzaC1lZDI1NTE5AAAAIH'
    });
  });

  it('sends nothing more while saving', async () => {
    const answer = new Subject<void>();
    api.replace.mockReturnValue(answer);
    await open();
    await tick();

    trust()?.click();
    await settleDialog();
    trust()?.click();
    await settleDialog();

    expect(api.replace).toHaveBeenCalledTimes(1);
    expect(trust()?.getAttribute('aria-disabled')).toBe('true');
    answer.complete();
  });

  it('stays open with the error when saving fails', async () => {
    api.replace.mockReturnValue(throwError(() => apiError(409, 'host-key-not-trusted')));
    await open();
    let closed = false;
    ref.closed.subscribe(() => closed = true);
    await tick();

    trust()?.click();
    await settleDialog();

    expect(closed).toBe(false);
    expect(overlay().querySelector('ui-inline-banner[status="danger"]')?.textContent).toContain('host-key-not-trusted');
    expect(trust()?.getAttribute('aria-disabled')).toBeNull();
  });

  it.each([
    [
      'github.com',
      'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints'
    ],
    [
      'GitHub.com',
      'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints'
    ],
    [ 'bitbucket.org', 'https://support.atlassian.com/bitbucket-cloud/docs/configure-ssh-and-two-step-verification/' ],
    // The providers' SSH over the HTTPS port, with the same keys.
    [
      'ssh.github.com',
      'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints'
    ],
    [
      'altssh.bitbucket.org',
      'https://support.atlassian.com/bitbucket-cloud/docs/configure-ssh-and-two-step-verification/'
    ]
  ])('links %s to the provider\'s published fingerprints', async (host, href) => {
    await open({ ...changed, host, port: 22 });

    expect(links().map(link => link.href)).toEqual([ href ]);
    expect(links()[0]?.target).toBe('_blank');
    expect(links()[0]?.rel).toContain('noopener');
  });

  it.each([
    'github.com.evil.example',
    'evilgithub.com',
    'gist.github.com',
    'bitbucket.org.example',
    'git.example.com',
    // Names of an object's inherited properties.
    'constructor',
    'toString',
    'valueOf',
    '__proto__'
  ])(
    'links only for the exact provider hosts: not %s',
    async host => {
      await open({ ...changed, host });

      expect(links()).toEqual([]);
    }
  );

  it('starts with the checkbox clear', async () => {
    await open();
    await tick();
    expect(checkbox()?.checked).toBe(true);
    dialogButton(`${KEY}.cancel`)?.click();
    await settleDialog();

    await open();

    expect(checkbox()?.checked).toBe(false);
    expect(trust()?.getAttribute('aria-disabled')).toBe('true');
  });

  it('Enter does not trust the key', async () => {
    await open();

    // Enter presses the focused button, and there is no form for it to submit: the default is Cancel.
    expect(document.activeElement).toBe(dialogButton(`${KEY}.cancel`));
    expect(overlay().querySelector('form, button[type=submit]')).toBeNull();

    await tick();
    checkbox()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settleDialog();

    expect(api.replace).not.toHaveBeenCalled();
  });

  it('cancels with nothing, changing nothing', async () => {
    await open();
    const closed = firstValueFrom(ref.closed);
    await tick();

    dialogButton(`${KEY}.cancel`)?.click();

    expect(await closed).toBeUndefined();
    expect(api.replace).not.toHaveBeenCalled();
  });

  it('offers no Trust without a new key, but Try again', async () => {
    await open({ host: 'git.example.com', port: 22, trustedType: 'ssh-rsa', trustedFingerprint: 'SHA256:trusted' });
    const closed = firstValueFrom(ref.closed);

    expect(overlay().textContent).toContain(`${KEY}.unreachable`);
    expect(trust()).toBeUndefined();
    expect(checkbox()).toBeNull();
    expect(values().find(text => text.includes(`${KEY}.trustedKey`))).toContain('SHA256:trusted');

    dialogButton(`${KEY}.tryAgain`)?.click();

    expect(await closed).toBe(true);
    expect(api.replace).not.toHaveBeenCalled();
  });

  it('moves focus to Cancel, and returns it on closing', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    await open();

    expect(document.activeElement).toBe(dialogButton(`${KEY}.cancel`));

    dialogButton(`${KEY}.cancel`)?.click();
    await settleDialog();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
