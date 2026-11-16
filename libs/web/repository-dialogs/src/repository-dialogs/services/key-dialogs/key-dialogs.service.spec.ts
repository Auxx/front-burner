import { TestBed } from '@angular/core/testing';
import type { RepositoryCredentialsInfo } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { Subject } from 'rxjs';

import { ChangedHostKeyDialog } from '../../dialogs/changed-host-key/changed-host-key.dialog';
import { UnlockKeyDialog, type UnlockKeyDialogData } from '../../dialogs/unlock-key/unlock-key.dialog';
import { KeyDialogsService, protectedKeyOf } from './key-dialogs.service';

const sshKey = {
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
} as const;
const dialogData: UnlockKeyDialogData = {
  id: 2,
  name: 'Laptop key',
  keyType: 'ed25519',
  fingerprint: sshKey.fingerprint
};
const info = (inUse: RepositoryCredentialsInfo['inUse']): RepositoryCredentialsInfo => ({ protocol: 'ssh', inUse });

describe('protectedKeyOf', () => {
  it('answers a passphrase-protected key with its public parts and whether it is unlocked', () => {
    expect(protectedKeyOf(info(sshKey))).toEqual({ key: dialogData, unlocked: false });
    expect(protectedKeyOf(info({ ...sshKey, unlocked: true }))).toEqual({ key: dialogData, unlocked: true });
  });

  it('answers nothing for a key without a passphrase, a missing secret, HTTPS or no credentials', () => {
    expect(protectedKeyOf(info({ ...sshKey, passphraseProtected: false }))).toBeNull();
    expect(protectedKeyOf(info({ ...sshKey, missing: true }))).toBeNull();
    expect(protectedKeyOf({
      protocol: 'https',
      inUse: { kind: 'https', id: 1, name: 'token', username: 'octocat', missing: false, usedBy: 1 }
    })).toBeNull();
    expect(protectedKeyOf(info(null))).toBeNull();
  });
});

describe('KeyDialogsService', () => {
  let closed: Subject<boolean | undefined>;
  let open: ReturnType<typeof vi.fn>;
  let service: KeyDialogsService;

  beforeEach(() => {
    closed = new Subject();
    open = vi.fn(() => ({ closed }));
    TestBed.configureTestingModule({ providers: [ { provide: DialogService, useValue: { open } } ] });
    service = TestBed.inject(KeyDialogsService);
  });

  const close = (result: boolean | undefined) => {
    closed.next(result);
    closed.complete();
  };

  it('unlocks a key in the unlock dialog', async () => {
    const unlocked = service.unlock(dialogData);
    close(true);

    expect(await unlocked).toBe(true);
    expect(open).toHaveBeenCalledWith(UnlockKeyDialog, { data: dialogData });
  });

  it('answers false when the unlock is cancelled', async () => {
    const unlocked = service.unlock(dialogData);
    close(undefined);

    expect(await unlocked).toBe(false);
  });

  it('shows the changed host key of a problem\'s params, with the port as a number', async () => {
    const params = { host: 'github.com', port: '22', type: 'ssh-ed25519', key: 'AAAA', fingerprint: 'SHA256:new' };

    const trusted = service.reviewHostKey(params);
    close(true);

    expect(await trusted).toBe(true);
    expect(open).toHaveBeenCalledWith(ChangedHostKeyDialog, { data: { ...params, port: 22 } });
  });

  it('answers false when the review is cancelled', async () => {
    const trusted = service.reviewHostKey({ host: 'github.com', port: '22' });
    close(undefined);

    expect(await trusted).toBe(false);
  });

  it('opens nothing for params that do not describe a changed key', async () => {
    expect(await service.reviewHostKey({ port: '22' })).toBeNull();
    expect(await service.reviewHostKey(undefined)).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});
