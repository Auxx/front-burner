import 'fake-indexeddb/auto';

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthApi, OidcApi } from '@front-burner/web-api-client';
import { IDBFactory } from 'fake-indexeddb';
import { of } from 'rxjs';

import { AUTH_STORAGE_KEY, AuthSessionService } from '../services/auth-session/auth-session.service';
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
      providers: [ { provide: AuthSessionService, useValue: { loggedIn } } ]
    });
    store = TestBed.inject(DraftStore);
    TestBed.tick();
  });

  it('stores, reads and deletes a draft', async () => {
    expect(await store.get(key('README.md'))).toBeNull();

    await store.put(key('README.md'), draft('# Edited'));
    expect(await store.get(key('README.md'))).toEqual(draft('# Edited'));
    expect(store.available).toBe(true);

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
      expect(store.available).toBe(false);
    });

    it('when opening it throws', async () => {
      vi.spyOn(globalThis.indexedDB, 'open').mockImplementation(() => {
        throw new DOMException('Blocked', 'SecurityError');
      });

      await expect(store.put(key('a.md'), draft('a'))).resolves.toBeUndefined();
      await expect(store.get(key('a.md'))).resolves.toBeNull();
      await expect(store.clearAll()).resolves.toBeUndefined();
      expect(store.available).toBe(false);
    });

    it('when opening it fails', async () => {
      vi.spyOn(globalThis.indexedDB, 'open').mockImplementation(() => {
        const request = {} as IDBOpenDBRequest;
        setTimeout(() => request.onerror?.(new Event('error')));
        return request;
      });

      await expect(store.put(key('a.md'), draft('a'))).resolves.toBeUndefined();
      await expect(store.get(key('a.md'))).resolves.toBeNull();
      expect(store.available).toBe(false);
    });
  });
});

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
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
      authToken: 'token',
      authTokenExpiresAt: '2026-10-29T10:15:00.000Z',
      refreshTokenExpiresAt: '2026-11-28T10:00:00.000Z'
    }));
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

  it('deletes drafts when another tab logs out', async () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_STORAGE_KEY, newValue: null }));
    await settled();

    expect(await store.get(key('b.md', 13, 2))).toBeNull();
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
