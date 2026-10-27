import { TestBed } from '@angular/core/testing';
import type { HostKey } from '@front-burner/shared-contracts';
import { DialogRef, DialogService } from '@front-burner/ui';
import { firstValueFrom } from 'rxjs';

import { button } from '../../../testing/form-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { TrustHostDialog } from './trust-host.dialog';

const KEY = 'web-feature-repositories.TrustHostDialog';

const hostKey: HostKey = {
  host: 'git.example.com',
  port: 2222,
  type: 'ssh-ed25519',
  key: 'AAAAC3NzaC1lZDI1NTE5AAAAIH',
  fingerprint: 'SHA256:examplefingerprint'
};

describe('TrustHostDialog', () => {
  let ref: DialogRef<boolean>;

  const dialog = () => document.querySelector('.cdk-overlay-container') as HTMLElement;

  async function open(key: HostKey = hostKey): Promise<void> {
    TestBed.configureTestingModule({ imports: [ translocoTesting() ] });
    ref = TestBed.inject(DialogService).open<TrustHostDialog, HostKey, boolean>(TrustHostDialog, { data: key });
    await vi.waitFor(() => expect(dialog().textContent).toContain(`${KEY}.heading`));
  }

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('asks whether to trust the server, with its host, key type and fingerprint', async () => {
    await open();

    expect(dialog().textContent).toContain('git.example.com:2222');
    expect(dialog().textContent).toContain('ssh-ed25519');
    expect(dialog().querySelector('code')?.textContent?.trim()).toBe('SHA256:examplefingerprint');
  });

  it('leaves out the standard SSH port', async () => {
    await open({ ...hostKey, port: 22 });

    expect(dialog().textContent).toContain('git.example.com');
    expect(dialog().textContent).not.toContain(':22');
  });

  it('closes with true on Trust', async () => {
    await open();
    const result = firstValueFrom(ref.closed);

    button(dialog(), `${KEY}.trust`)?.click();

    expect(await result).toBe(true);
  });

  it('closes with false on Cancel', async () => {
    await open();
    const result = firstValueFrom(ref.closed);

    button(dialog(), `${KEY}.cancel`)?.click();

    expect(await result).toBe(false);
  });
});
