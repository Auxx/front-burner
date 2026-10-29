import 'fake-indexeddb/auto';

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthApi, OidcApi } from '@front-burner/web-api-client';
import { IDBFactory } from 'fake-indexeddb';
import { of, Subject } from 'rxjs';

import { AUTH_STORAGE_KEY, AuthSessionService, type SessionEnd } from '../services/auth-session/auth-session.service';
import { type DraftKey, DraftStore } from './draft-store';

const key = (path: string, repositoryId = 12, userId = 1): DraftKey => ({ userId, repositoryId, path });
const draft = (content: string) => ({ content, savedAt: '2026-10-29T10:00:00.000Z' });

describe('DraftStore', () => {
  let store: DraftStore;
  let loggedIn: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    loggedIn = signal(true);
    TestBed.configureTestingModule({
      providers: [ { provide: AuthSessionService, useValue: { loggedIn, ended: new Subject<SessionEnd>() } } ]
    });
    store = TestBed.inject(DraftStore);
    TestBed.tick();
  });

  it('stores, reads and deletes a draft', async () => {
    expect(await store.get(key('README.md'))).toBeNull();

    await store.put(key('README.md'), draft('# Edited'));
    expect(await store.get(key('README.md'))).toEqual(draft('# Edited'));

    await store.delete(key('README.md'));
    expect(await store.get(key('README.md'))).toBeNull();
  });

  it('keeps drafts of users, repositories and paths apart', async () => {
    await store.put(key('a.md', 12, 1), draft('user 1'));
    await store.put(key('a.md', 12, 2), draft('user 2'));
    await store.put(key('a.md', 13, 1), draft('repository 13'));
    await store.put(key('a.md.bak', 12, 1), draft('sibling'));

    await store.delete(key('a.md', 12, 1));

    expect(await store.get(key('a.md', 12, 1))).toBeNull();
    expect(await store.get(key('a.md', 12, 2))).toEqual(draft('user 2'));
    expect(await store.get(key('a.md', 13, 1))).toEqual(draft('repository 13'));
    expect(await store.get(key('a.md.bak', 12, 1))).toEqual(draft('sibling'));
  });

  it('deletes the drafts under a folder', async () => {
    await store.put(key('docs/a.md'), draft('a'));
    await store.put(key('docs/deep/b.md'), draft('b'));
    await store.put(key('docs-old/c.md'), draft('c'));

    await store.delete(key('docs'));

    expect(await store.get(key('docs/a.md'))).toBeNull();
    expect(await store.get(key('docs/deep/b.md'))).toBeNull();
    expect(await store.get(key('docs-old/c.md'))).toEqual(draft('c'));
  });

  it('moves a draft', async () => {
    await store.put(key('old.md'), draft('moved'));

    await store.move(key('old.md'), key('new.md'));

    expect(await store.get(key('old.md'))).toBeNull();
    expect(await store.get(key('new.md'))).toEqual(draft('moved'));
  });

  it('moves the drafts under a folder', async () => {
    await store.put(key('docs/a.md'), draft('a'));
    await store.put(key('docs/deep/b.md'), draft('b'));
    await store.put(key('docs.md'), draft('sibling'));

    await store.move(key('docs'), key('guide'));

    expect(await store.get(key('guide/a.md'))).toEqual(draft('a'));
    expect(await store.get(key('guide/deep/b.md'))).toEqual(draft('b'));
    expect(await store.get(key('docs/a.md'))).toBeNull();
    expect(await store.get(key('docs.md'))).toEqual(draft('sibling'));
  });

  it('clears every draft', async () => {
    await store.put(key('a.md', 12, 1), draft('a'));
    await store.put(key('b.md', 13, 2), draft('b'));

    await store.clearAll();

    expect(await store.get(key('a.md', 12, 1))).toBeNull();
    expect(await store.get(key('b.md', 13, 2))).toBeNull();
  });

  describe('works without IndexedDB', () => {
    it('when the browser has none', async () => {
      Reflect.deleteProperty(globalThis, 'indexedDB');

      await expect(store.put(key('a.md'), draft('a'))).resolves.toBeUndefined();
      await expect(store.get(key('a.md'))).resolves.toBeNull();
      await expect(store.move(key('a.md'), key('b.md'))).resolves.toBeUndefined();
      await expect(store.delete(key('a.md'))).resolves.toBeUndefined();
      await expect(store.clearAll()).resolves.toBeUndefined();
    });

    it('when opening it throws', async () => {
      vi.spyOn(globalThis.indexedDB, 'open').mockImplementation(() => {
        throw new DOMException('Blocked', 'SecurityError');
      });

      await expect(store.put(key('a.md'), draft('a'))).resolves.toBeUndefined();
      await expect(store.get(key('a.md'))).resolves.toBeNull();
      await expect(store.clearAll()).resolves.toBeUndefined();
    });

    it('when opening it fails', async () => {
      vi.spyOn(globalThis.indexedDB, 'open').mockImplementation(() => {
        const request = {} as IDBOpenDBRequest;
        setTimeout(() => request.onerror?.(new Event('error')));
        return request;
      });

      await expect(store.put(key('a.md'), draft('a'))).resolves.toBeUndefined();
      await expect(store.get(key('a.md'))).resolves.toBeNull();
    });
  });

  it('finds no draft whose time is not a date', async () => {
    await store.put(key('a.md'), { content: 'a', savedAt: 'yesterday-ish' });

    expect(await store.get(key('a.md'))).toBeNull();
  });

  it('opens the database again after the browser closed it', async () => {
    const open = vi.spyOn(globalThis.indexedDB, 'open');
    await store.put(key('a.md'), draft('a'));
    const database = open.mock.results[0].value.result as IDBDatabase;

    database.close();
    database.onclose?.(new Event('close'));
    await store.put(key('b.md'), draft('b'));

    expect(await store.get(key('b.md'))).toEqual(draft('b'));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('does not block another tab upgrading the database', async () => {
    await store.put(key('a.md'), draft('a'));

    const upgrade = globalThis.indexedDB.open('front-burner', 2);
    const outcome = await new Promise<string>(resolve => {
      upgrade.onblocked = () => resolve('blocked');
      upgrade.onsuccess = () => resolve('upgraded');
    });

    expect(outcome).toBe('upgraded');
    upgrade.result.close();
  });

  describe('claims', () => {
    afterEach(() => Reflect.deleteProperty(navigator, 'locks'));

    it('tells whether another tab has the file open', async () => {
      Object.defineProperty(navigator, 'locks', { value: fakeLocks(), configurable: true });

      const release = store.claim(key('a.md'));
      await Promise.resolve();

      expect(await store.claimedElsewhere(key('a.md'))).toBe(true);
      expect(await store.claimedElsewhere(key('b.md'))).toBe(false);

      release();
      await new Promise(resolve => setTimeout(resolve));
      expect(await store.claimedElsewhere(key('a.md'))).toBe(false);
    });

    it('claims nothing without Web Locks', async () => {
      const release = store.claim(key('a.md'));

      expect(await store.claimedElsewhere(key('a.md'))).toBe(false);
      expect(() => release()).not.toThrow();
    });
  });
});

/** Web Locks within one page: enough to tell held lock names. */
function fakeLocks(): Pick<LockManager, 'request' | 'query'> {
  const held: string[] = [];
  return {
    request: (async (name: string, _options: LockOptions, callback: () => Promise<void>) => {
      held.push(name);
      try {
        await callback();
      } finally {
        held.splice(held.indexOf(name), 1);
      }
    }) as LockManager['request'],
    query: async () => ({ held: held.map(name => ({ name, mode: 'shared' as const })), pending: [] })
  };
}

describe('DraftStore when the session ends', () => {
  let store: DraftStore;
  let session: AuthSessionService;
  let logout: ReturnType<typeof vi.fn>;

  /** Waits for the clearing, which runs on its own: reading waits behind its transaction. */
  async function settled(): Promise<void> {
    TestBed.tick();
    await store.get(key('any.md'));
  }

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        authToken: 'token',
        authTokenExpiresAt: '2026-10-29T10:15:00.000Z',
        refreshTokenExpiresAt: '2026-11-28T10:00:00.000Z'
      })
    );
    logout = vi.fn(() => of(undefined));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([ { path: 'login', children: [] } ]),
        { provide: AuthApi, useValue: { logout } },
        { provide: OidcApi, useValue: {} }
      ]
    });
    session = TestBed.inject(AuthSessionService);
    store = TestBed.inject(DraftStore);
    await settled();
    await store.put(key('a.md', 12, 1), draft('a'));
    await store.put(key('b.md', 13, 2), draft('b'));
  });

  afterEach(() => localStorage.clear());

  it('AC-EDIT-001.7: deletes every draft on logout', async () => {
    await session.logout();
    await settled();

    expect(logout).toHaveBeenCalled();
    expect(await store.get(key('a.md', 12, 1))).toBeNull();
    expect(await store.get(key('b.md', 13, 2))).toBeNull();
  });

  it('deletes drafts when the session expires', async () => {
    await session.expire();
    await settled();

    expect(await store.get(key('a.md', 12, 1))).toBeNull();
  });

  it('keeps drafts when a refresh could not reach the backend', async () => {
    await session.expire('/', 'unreachable');
    await settled();

    expect(await store.get(key('a.md', 12, 1))).toEqual(draft('a'));
  });

  it('leaves the drafts to the tab that logged out', async () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_STORAGE_KEY, newValue: null }));
    await settled();

    expect(session.loggedIn()).toBe(false);
    expect(await store.get(key('b.md', 13, 2))).toEqual(draft('b'));
    // Nor does this tab write any more of them.
    await store.put(key('c.md'), draft('c'));
    expect(await store.get(key('c.md'))).toBeNull();
  });

  it('stops writing drafts once the session ends', async () => {
    // A put on its way when the session ends is cleared with the rest.
    const onItsWay = store.put(key('late.md'), draft('late'));
    await session.expire();
    await onItsWay;
    await settled();
    // A save queue still running after the clearing writes nothing.
    await store.put(key('after.md'), draft('after'));

    expect(await store.get(key('late.md'))).toBeNull();
    expect(await store.get(key('after.md'))).toBeNull();
  });

  it('keeps the drafts while the user stays logged in', async () => {
    await settled();

    expect(await store.get(key('a.md', 12, 1))).toEqual(draft('a'));
  });
});
