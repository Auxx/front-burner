import type { Provider } from '@angular/core';
import { type Draft, type DraftKey, DraftStore } from '@front-burner/web-core';

/**
 * The browser drafts in memory, for specs, under the keys of the real store
 * (`<userId>/<repositoryId>/<path>`). A folder's path names the drafts under
 * it, as in the real store.
 */
export class MemoryDraftStore
  implements Pick<DraftStore, 'available' | 'put' | 'get' | 'delete' | 'move' | 'clearAll'> {
  readonly drafts = new Map<string, Draft>();
  readonly available = true;

  /** The draft of user 4's file at `path` in repository 12, as the specs' fakes name them. */
  at(path: string, repositoryId = 12, userId = 4): Draft | undefined {
    return this.drafts.get(`${userId}/${repositoryId}/${path}`);
  }

  async put(key: DraftKey, draft: Draft): Promise<void> {
    this.drafts.set(keyOf(key), draft);
  }

  async get(key: DraftKey): Promise<Draft | null> {
    return this.drafts.get(keyOf(key)) ?? null;
  }

  async delete(key: DraftKey): Promise<void> {
    const prefix = keyOf(key);
    for (const stored of [ ...this.drafts.keys() ]) {
      if (stored === prefix || stored.startsWith(`${prefix}/`)) {
        this.drafts.delete(stored);
      }
    }
  }

  async move(from: DraftKey, to: DraftKey): Promise<void> {
    const prefix = keyOf(from);
    for (const [ stored, draft ] of [ ...this.drafts ]) {
      if (stored === prefix || stored.startsWith(`${prefix}/`)) {
        this.drafts.delete(stored);
        this.drafts.set(keyOf(to) + stored.slice(prefix.length), draft);
      }
    }
  }

  async clearAll(): Promise<void> {
    this.drafts.clear();
  }
}

function keyOf({ userId, repositoryId, path }: DraftKey): string {
  return `${userId}/${repositoryId}/${path}`;
}

/** Provides a {@link MemoryDraftStore} as the `DraftStore`. */
export function provideMemoryDrafts(store = new MemoryDraftStore()): Provider {
  return { provide: DraftStore, useValue: store };
}
