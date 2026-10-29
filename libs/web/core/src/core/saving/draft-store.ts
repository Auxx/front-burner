import { inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthSessionService } from '../services/auth-session/auth-session.service';

/** Names a browser draft: one file of one user's repository. */
export interface DraftKey {
  userId: number;
  repositoryId: number;
  /** The file's path in the working copy, as on the wire. */
  path: string;
}

/** Unsaved content kept in the browser (NF-3.3); never a secret. */
export interface Draft {
  content: string;
  /** When it was written, as an ISO time. */
  savedAt: string;
}

const DATABASE = 'front-burner';
const STORE = 'drafts';
/** The Web Lock a tab holds, shared, while it has a file open. */
const LOCK = 'front-burner.draft';

function keyOf({ userId, repositoryId, path }: DraftKey): string {
  return `${userId}/${repositoryId}/${path}`;
}

function lockOf(key: DraftKey): string {
  return `${LOCK}:${keyOf(key)}`;
}

/** Whether `key` names the draft at `prefix` or one under the folder at `prefix`. */
function isWithin(key: string, prefix: string): boolean {
  return key === prefix || key.startsWith(`${prefix}/`);
}

/** The result of `request`, once it succeeds. */
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/** Resolves once `transaction` has committed. */
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * The browser drafts (A-8.10, NF-3.3): unsaved content in IndexedDB, in the
 * object store `drafts` of the database `front-burner`, keyed by user,
 * repository and path. Uses the native API.
 *
 * Every draft is deleted when this tab ends the session: on logout, and when
 * the backend refuses it, so that the user must log in again (NF-3.5). A
 * session that ended because a refresh could not reach the backend keeps
 * them, since the drafts are there to survive a lost connection (NF-3.3) and
 * the user can log back in. A logout in another tab is deleted by that tab
 * (NV-8). While the user is not logged in `put` writes nothing, so that a save
 * queue still running writes no more drafts. `provideCore` creates the store
 * at start-up, so that a tab that never opened the editor deletes them too.
 *
 * A tab `claim`s each file it has open, so that another tab does not offer
 * that file's draft, which is still being saved (D-1.3). Where the browser has
 * no Web Locks, every draft is offered.
 *
 * Where IndexedDB is missing or fails, such as in a private window or with
 * storage turned off, drafts are skipped: every method resolves, never
 * rejects, and `get` finds nothing.
 */
@Injectable({ providedIn: 'root' })
export class DraftStore {
  private readonly session = inject(AuthSessionService);
  private database: Promise<IDBDatabase | null> | undefined;

  constructor() {
    this.session.ended.pipe(takeUntilDestroyed()).subscribe(end => {
      if (end !== 'unreachable') {
        void this.clearAll();
      }
    });
  }

  /** Stores the draft at `key`; does nothing while the user is not logged in. */
  async put(key: DraftKey, draft: Draft): Promise<void> {
    if (!this.session.loggedIn()) {
      return;
    }
    await this.write(store => store.put({ content: draft.content, savedAt: draft.savedAt }, keyOf(key)), true);
  }

  async get(key: DraftKey): Promise<Draft | null> {
    const database = await this.open();
    if (!database) {
      return null;
    }
    try {
      const value: unknown = await result(database.transaction(STORE, 'readonly').objectStore(STORE).get(keyOf(key)));
      if (typeof value !== 'object' || value === null) {
        return null;
      }
      const { content, savedAt } = value as Record<string, unknown>;
      return typeof content === 'string' && typeof savedAt === 'string' && !Number.isNaN(Date.parse(savedAt))
        ? { content, savedAt }
        : null;
    } catch {
      return null;
    }
  }

  /** Deletes the draft at `key`, or every draft under the folder at `key`'s path. */
  async delete(key: DraftKey): Promise<void> {
    const prefix = keyOf(key);
    await this.write(store => this.each(store, prefix, cursor => cursor.delete()));
  }

  /**
   * Moves the draft at `from`, or every draft under the folder at `from`'s
   * path, to its path under `to`, such as after a rename (FB-36).
   */
  async move(from: DraftKey, to: DraftKey): Promise<void> {
    const prefix = keyOf(from);
    const target = keyOf(to);
    if (prefix === target) {
      return;
    }
    await this.write(store =>
      this.each(store, prefix, cursor => {
        const key = cursor.key as string;
        store.put(cursor.value, target + key.slice(prefix.length));
        cursor.delete();
      })
    );
  }

  /** Deletes every draft of every user (NF-3.5). */
  async clearAll(): Promise<void> {
    await this.write(store => store.clear());
  }

  /**
   * Marks the file at `key` as open in this tab until the returned function is
   * called; does nothing without Web Locks.
   */
  claim(key: DraftKey): () => void {
    const locks = globalThis.navigator?.locks as LockManager | undefined;
    let release = (): void => undefined;
    if (locks) {
      const held = new Promise<void>(resolve => (release = resolve));
      locks.request(lockOf(key), { mode: 'shared' }, () => held).catch(() => undefined);
    }
    return release;
  }

  /** Whether another tab has claimed the file at `key`; asked before this tab claims it. */
  async claimedElsewhere(key: DraftKey): Promise<boolean> {
    const locks = globalThis.navigator?.locks as LockManager | undefined;
    try {
      const { held = [] } = (await locks?.query()) ?? {};
      return held.some(lock => lock.name === lockOf(key));
    } catch {
      return false;
    }
  }

  /** Runs `change` in a read-write transaction and waits for it to commit; does nothing without IndexedDB. */
  private async write(change: (store: IDBObjectStore) => void, whileLoggedIn = false): Promise<void> {
    const database = await this.open();
    // A logout while the database was opened: its clearing may already have run.
    if (!database || (whileLoggedIn && !this.session.loggedIn())) {
      return;
    }
    try {
      const transaction = database.transaction(STORE, 'readwrite');
      change(transaction.objectStore(STORE));
      await committed(transaction);
    } catch {
      // The draft is lost, as without IndexedDB.
    }
  }

  /** Calls `visit` for the draft at `prefix` and each draft under it. */
  private each(store: IDBObjectStore, prefix: string, visit: (cursor: IDBCursorWithValue) => void): void {
    const request = store.openCursor(IDBKeyRange.lowerBound(prefix));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        return;
      }
      const key = cursor.key as string;
      if (isWithin(key, prefix)) {
        visit(cursor);
        cursor.continue();
      } else if (key.startsWith(prefix)) {
        // A sibling such as `a.md.bak` for `a.md`, between `a.md` and `a.md/…`.
        cursor.continue();
      }
    };
  }

  /**
   * The database, opened once, and again after the browser closed it, such as
   * when the site's data is cleared; `null` without IndexedDB.
   */
  private open(): Promise<IDBDatabase | null> {
    this.database ??= this.connect().catch(() => null);
    return this.database;
  }

  private async connect(): Promise<IDBDatabase | null> {
    const factory = globalThis.indexedDB as IDBFactory | undefined;
    if (!factory) {
      return null;
    }
    const request = factory.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    const database = await result(request);
    database.onclose = () => (this.database = undefined);
    // Another tab upgrades the database: this connection must not block it.
    database.onversionchange = () => {
      database.close();
      this.database = undefined;
    };
    return database;
  }
}
