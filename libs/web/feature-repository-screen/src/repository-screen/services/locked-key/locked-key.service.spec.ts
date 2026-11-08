import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PushEvent, RepositoryCredentialsInfo } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { PushChannelService } from '@front-burner/web-core';
import { UnlockKeyDialog } from '@front-burner/web-repository-dialogs';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';
import { type LockedKey, LockedKeyService } from './locked-key.service';

const laptop: LockedKey = { id: 3, name: 'laptop', keyType: 'ed25519', fingerprint: 'SHA256:abc' };

function sshKey(changes: { passphraseProtected?: boolean; unlocked?: boolean; missing?: boolean; } = {}) {
  return {
    kind: 'ssh-key' as const,
    ...laptop,
    passphraseProtected: true,
    unlocked: false,
    generated: false,
    missing: false,
    usedBy: 2,
    ...changes
  };
}

const locked: RepositoryCredentialsInfo = { protocol: 'ssh', inUse: sshKey() };
const unlocked: RepositoryCredentialsInfo = { protocol: 'ssh', inUse: sshKey({ unlocked: true }) };

describe('LockedKeyService', () => {
  let repositoryCredentials: ReturnType<typeof vi.fn<(id: number) => Observable<RepositoryCredentialsInfo>>>;
  let open: ReturnType<typeof vi.fn>;
  let closed: Subject<boolean | undefined>;
  let events: Subject<PushEvent>;
  let reconnected: Subject<void>;
  let followed: ReturnType<typeof signal<number | null>>;
  let sessionState: ReturnType<typeof signal<string>>;
  let service: LockedKeyService;

  const settle = async () => {
    TestBed.tick();
    await new Promise(resolve => setTimeout(resolve));
  };

  async function start(answer: RepositoryCredentialsInfo): Promise<void> {
    repositoryCredentials.mockReturnValue(of(answer));
    service = TestBed.inject(LockedKeyService);
    await settle();
  }

  beforeEach(() => {
    repositoryCredentials = vi.fn();
    closed = new Subject();
    open = vi.fn(() => ({ closed }));
    events = new Subject();
    reconnected = new Subject();
    followed = signal(12);
    sessionState = signal('ready');
    TestBed.configureTestingModule({
      providers: [
        LockedKeyService,
        { provide: RepositoriesApi, useValue: { repositoryCredentials } },
        { provide: DialogService, useValue: { open } },
        { provide: PushChannelService, useValue: { events, reconnected } },
        { provide: GitStatusStore, useValue: { followed } },
        {
          provide: RepositorySessionService,
          useValue: { state: sessionState, repository: () => ({ id: followed() }) }
        }
      ]
    });
  });

  it('shows the banner for a locked key, and none for an unlocked one, a key with no passphrase or no credentials', async () => {
    await start(locked);
    expect(repositoryCredentials).toHaveBeenCalledWith(12);
    expect(service.key()).toEqual(laptop);

    for (
      const answer of [
        unlocked,
        { protocol: 'ssh', inUse: sshKey({ passphraseProtected: false }) },
        { protocol: 'ssh', inUse: null },
        {
          protocol: 'https',
          inUse: { kind: 'https', id: 4, name: 'token', username: 'ada', missing: false, usedBy: 1 }
        }
      ] satisfies RepositoryCredentialsInfo[]
    ) {
      repositoryCredentials.mockReturnValue(of(answer));
      reconnected.next();
      await settle();
      expect(service.key()).toBeNull();
    }
  });

  it('does not offer to unlock a key whose secret is missing', async () => {
    await start({ protocol: 'ssh', inUse: sshKey({ missing: true }) });

    expect(service.key()).toBeNull();
  });

  it('reads again after a reconnect, which shows the banner after a backend restart', async () => {
    await start(unlocked);
    expect(service.key()).toBeNull();

    repositoryCredentials.mockReturnValue(of(locked));
    reconnected.next();
    await settle();

    expect(service.key()).toEqual(laptop);
  });

  it('reads the key again when asked, such as after the credentials were replaced', async () => {
    await start({ protocol: 'ssh', inUse: null });
    expect(service.key()).toBeNull();

    repositoryCredentials.mockReturnValue(of(locked));
    await service.reread();

    expect(service.key()).toEqual(laptop);
  });

  it('shows the banner again for another locked key after a dismissal, but not for the same one', async () => {
    await start(locked);
    service.dismissed.set(true);

    await service.reread();
    expect(service.dismissed()).toBe(true);

    const other = { ...sshKey(), id: 8, name: 'desktop' };
    repositoryCredentials.mockReturnValue(of({ protocol: 'ssh', inUse: other } satisfies RepositoryCredentialsInfo));
    await service.reread();

    expect(service.key()).toEqual(expect.objectContaining({ id: 8, name: 'desktop' }));
    expect(service.dismissed()).toBe(false);
  });

  it('removes the banner on key.unlocked', async () => {
    await start(locked);

    events.next({ type: 'key.unlocked', keyId: 99 });
    expect(service.key()).toEqual(laptop);

    events.next({ type: 'key.unlocked', keyId: 3 });
    expect(service.key()).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('shows the key again when key.locked says its unlock ended', async () => {
    await start(unlocked);
    expect(service.key()).toBeNull();

    repositoryCredentials.mockReturnValue(of(locked));
    events.next({ type: 'key.locked', keyId: 3 });
    await settle();

    expect(service.key()).toEqual(laptop);
    expect(open).not.toHaveBeenCalled();
  });

  it('a dismissed banner stays away for the visit', async () => {
    await start(locked);
    service.dismissed.set(true);

    reconnected.next();
    await settle();
    expect(service.dismissed()).toBe(true);

    followed.set(13);
    await settle();
    expect(service.dismissed()).toBe(false);
  });

  it('opens the dialog with the key, and removes the banner after the unlock', async () => {
    await start(locked);

    const unlocking = service.unlock();
    await settle();
    expect(open).toHaveBeenCalledExactlyOnceWith(UnlockKeyDialog, { data: laptop });
    closed.next(true);
    closed.complete();

    expect(await unlocking).toBe(true);
    expect(service.key()).toBeNull();
  });

  it('keeps the banner when the dialog is cancelled', async () => {
    await start(locked);

    const unlocking = service.unlock();
    await settle();
    closed.next(undefined);
    closed.complete();

    expect(await unlocking).toBe(false);
    expect(service.key()).toEqual(laptop);
  });

  it('asks when the key locked itself after the banner went away', async () => {
    await start(locked);
    events.next({ type: 'key.unlocked', keyId: 3 });
    expect(service.key()).toBeNull();

    // The unlock ended after its idle time: the push is refused with key-locked.
    const unlocking = service.unlock();
    await settle();

    expect(repositoryCredentials).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledExactlyOnceWith(UnlockKeyDialog, { data: laptop });
    closed.next(true);
    closed.complete();
    expect(await unlocking).toBe(true);
  });

  it('opens one dialog for two requests', async () => {
    await start(locked);

    const first = service.unlock();
    const second = service.unlock();
    await settle();
    closed.next(true);
    closed.complete();

    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(open).toHaveBeenCalledOnce();
  });

  it('resolves true without asking for a key that turns out to be unlocked', async () => {
    await start(unlocked);

    expect(await service.unlock()).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('keeps a dismissal while the session opens the same repository again', async () => {
    await start(locked);
    service.dismissed.set(true);

    sessionState.set('loading');
    await settle();
    sessionState.set('ready');
    await settle();

    expect(service.dismissed()).toBe(true);
    expect(service.key()).toEqual(laptop);
  });

  it('rejects, asking nothing, when the key can\'t be read to ask for it', async () => {
    await start(unlocked);
    repositoryCredentials.mockReturnValue(throwError(() => new Error('offline')));

    await expect(service.unlock()).rejects.toThrow('offline');
    expect(open).not.toHaveBeenCalled();
  });

  it('does not ask about a key unlocked while it was being read', async () => {
    await start(locked);
    events.next({ type: 'key.unlocked', keyId: 3 });
    const answer = new Subject<RepositoryCredentialsInfo>();
    repositoryCredentials.mockReturnValue(answer);

    const unlocking = service.unlock();
    await settle();
    // Another tab of this session unlocked it again meanwhile.
    events.next({ type: 'key.unlocked', keyId: 3 });
    answer.next(locked);
    answer.complete();

    expect(await unlocking).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('keeps what it showed when a read fails', async () => {
    await start(locked);

    repositoryCredentials.mockReturnValue(throwError(() => new Error('offline')));
    reconnected.next();
    await settle();

    expect(service.key()).toEqual(laptop);
  });
});
