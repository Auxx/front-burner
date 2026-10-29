import { Injectable } from '@angular/core';

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

function keyOf({ userId, repositoryId, path }: DraftKey): string {
  return `${userId}/${repositoryId}/${path}`;
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
 * Where IndexedDB is missing or fails, such as in a private window or with
 * storage turned off, drafts are skipped: every method resolves, never
 * rejects, and `get` finds nothing.
 */
@Injectable({ providedIn: 'root' })
export class DraftStore {
  private database: Promise<IDBDatabase | null> | undefined;
  private works = true;

  /** Whether drafts can be kept; false once IndexedDB is found missing or failing. */
  get available(): boolean {
    return this.works;
  }

  async put(key: DraftKey, draft: Draft): Promise<void> {
    await this.write(store => store.put({ content: draft.content, savedAt: draft.savedAt }, keyOf(key)));
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
      return typeof content === 'string' && typeof savedAt === 'string' ? { content, savedAt } : null;
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

  /** Runs `change` in a read-write transaction and waits for it to commit; does nothing without IndexedDB. */
  private async write(change: (store: IDBObjectStore) => void): Promise<void> {
    const database = await this.open();
    if (!database) {
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

  /** The database, opened once; `null` without IndexedDB. */
  private open(): Promise<IDBDatabase | null> {
    this.database ??= this.connect().catch(() => {
      this.works = false;
      return null;
    });
    return this.database;
  }

  private async connect(): Promise<IDBDatabase | null> {
    const factory = globalThis.indexedDB as IDBFactory | undefined;
    if (!factory) {
      this.works = false;
      return null;
    }
    const request = factory.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    return result(request);
  }
}
