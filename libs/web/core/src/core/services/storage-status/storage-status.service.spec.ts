import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CurrentUser, InstanceStorage } from '@front-burner/shared-contracts';
import { InstanceApi } from '@front-burner/web-api-client';
import { of, Subject, throwError } from 'rxjs';

import { AuthSessionService } from '../auth-session/auth-session.service';
import { CurrentUserService } from '../current-user/current-user.service';
import { PushChannelService } from '../push-channel/push-channel.service';
import { STORAGE_STATUS_INTERVAL_MS, StorageStatusService } from './storage-status.service';

const admin: CurrentUser = {
  id: 1,
  email: 'ada@example.com',
  displayName: 'Ada',
  role: 'administrator',
  allowedGitLevels: [ 'advanced' ]
};

describe('StorageStatusService', () => {
  let loggedIn: ReturnType<typeof signal<boolean>>;
  let user: ReturnType<typeof signal<CurrentUser | undefined>>;
  let storage: ReturnType<typeof vi.fn>;
  let low: boolean;
  let reconnected: Subject<void>;
  let visibility: DocumentVisibilityState;

  /** Starts the service, then the pages with the app header load `who`. */
  const start = (who: CurrentUser = admin): StorageStatusService => {
    const service = TestBed.inject(StorageStatusService);
    TestBed.tick();
    user.set(who);
    TestBed.tick();
    return service;
  };

  const setVisibility = (state: DocumentVisibilityState) => {
    visibility = state;
    TestBed.inject(DOCUMENT).dispatchEvent(new Event('visibilitychange'));
    TestBed.tick();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    loggedIn = signal(true);
    user = signal<CurrentUser | undefined>(undefined);
    low = true;
    storage = vi.fn(() => of({ low } satisfies InstanceStorage));
    reconnected = new Subject();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthSessionService, useValue: { loggedIn } },
        { provide: CurrentUserService, useValue: { user } },
        { provide: InstanceApi, useValue: { storage } },
        { provide: PushChannelService, useValue: { reconnected } }
      ]
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reads the state on start for an administrator', async () => {
    const service = start();
    await vi.advanceTimersByTimeAsync(0);

    expect(storage).toHaveBeenCalledOnce();
    expect(service.low()).toBe(true);
  });

  it('hides the banner when the next read says storage is no longer low', async () => {
    const service = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.low()).toBe(true);

    low = false;
    await vi.advanceTimersByTimeAsync(STORAGE_STATUS_INTERVAL_MS);

    expect(service.low()).toBe(false);
  });

  it('reads the state every 5 minutes while the tab is visible', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2 * STORAGE_STATUS_INTERVAL_MS);
    expect(storage).toHaveBeenCalledTimes(3);

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(3 * STORAGE_STATUS_INTERVAL_MS);
    expect(storage).toHaveBeenCalledTimes(3);

    // Back in view: read at once, then on the interval again.
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(storage).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(STORAGE_STATUS_INTERVAL_MS);
    expect(storage).toHaveBeenCalledTimes(5);
  });

  it('does not read again on a tab switch when the last read is recent', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage).toHaveBeenCalledOnce();

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(60_000);
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(storage).toHaveBeenCalledOnce();

    // Read when the interval since the last read is up, not a full interval after the switch.
    await vi.advanceTimersByTimeAsync(STORAGE_STATUS_INTERVAL_MS - 60_000);
    expect(storage).toHaveBeenCalledTimes(2);
  });

  it('turns the banner off and stops reading when the user is no longer an administrator', async () => {
    const service = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.low()).toBe(true);

    storage.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { code: 'forbidden' } })));
    await vi.advanceTimersByTimeAsync(STORAGE_STATUS_INTERVAL_MS);
    TestBed.tick();
    expect(service.low()).toBe(false);

    service.refresh();
    reconnected.next();
    await vi.advanceTimersByTimeAsync(3 * STORAGE_STATUS_INTERVAL_MS);
    expect(storage).toHaveBeenCalledTimes(2);

    // A new login starts over.
    storage.mockImplementation(() => of({ low } satisfies InstanceStorage));
    loggedIn.set(false);
    TestBed.tick();
    loggedIn.set(true);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage).toHaveBeenCalledTimes(3);
    expect(service.low()).toBe(true);
  });

  it('reads the state again after a reconnect', async () => {
    const service = start();
    await vi.advanceTimersByTimeAsync(0);
    low = false;

    reconnected.next();
    await vi.advanceTimersByTimeAsync(0);

    expect(storage).toHaveBeenCalledTimes(2);
    expect(service.low()).toBe(false);
  });

  it('reads the state again after a low-storage error', async () => {
    low = false;
    const service = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.low()).toBe(false);

    low = true;
    service.refresh();
    await vi.advanceTimersByTimeAsync(0);

    expect(storage).toHaveBeenCalledTimes(2);
    expect(service.low()).toBe(true);
  });

  it('keeps the last state when a read fails', async () => {
    const service = start();
    await vi.advanceTimersByTimeAsync(0);

    storage.mockReturnValueOnce(throwError(() => new Error('offline')));
    await vi.advanceTimersByTimeAsync(STORAGE_STATUS_INTERVAL_MS);
    expect(service.low()).toBe(true);

    low = false;
    await vi.advanceTimersByTimeAsync(STORAGE_STATUS_INTERVAL_MS);
    expect(service.low()).toBe(false);
  });

  it('does not ask for a user', async () => {
    const service = start({ ...admin, role: 'user' });
    await vi.advanceTimersByTimeAsync(0);

    service.refresh();
    reconnected.next();
    await vi.advanceTimersByTimeAsync(3 * STORAGE_STATUS_INTERVAL_MS);

    expect(storage).not.toHaveBeenCalled();
    expect(service.low()).toBe(false);
  });

  it('stops reading and forgets the state on logout', async () => {
    const service = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.low()).toBe(true);

    loggedIn.set(false);
    user.set(undefined);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(3 * STORAGE_STATUS_INTERVAL_MS);

    expect(service.low()).toBe(false);
    expect(storage).toHaveBeenCalledOnce();
  });
});
