import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import type { Entry, FolderListing } from '@front-burner/shared-contracts';
import { FilesApi } from '@front-burner/web-api-client';
import { CurrentUserService, toApiError } from '@front-burner/web-core';
import { TranslocoService } from '@jsverse/transloco';
import type { Subscription } from 'rxjs';

import type { TreeEntry, TreeEntryKind } from '../../models/tree-entry.model';

type FolderState =
  | { readonly status: 'loading'; }
  | { readonly status: 'error'; }
  | { readonly status: 'loaded'; readonly listing: FolderListing; };

/** How a listing request ended: `missing` when the folder is not there (any more). */
type Outcome = FolderListing | 'missing' | 'failed';

interface Request {
  readonly done: Promise<Outcome>;
  /** Drops this request for a newer one, whose outcome it then waits for. */
  supersede(next: Promise<Outcome>): void;
}

const KEY = 'web-feature-repository-screen.FileTreeStoreService';

/**
 * The file tree of the working copy open on the repository screen (A-8.2).
 * Provided by the page. It holds each loaded folder's listing by path, one
 * folder at a time (FB-15), and turns them into the rows of `ui-tree`, with
 * the rows a folder adds while it loads (FB-43), when it fails (FB-44), when
 * it has more entries than listed (FB-18) or none (FB-33).
 *
 * Each device remembers the expanded folders of each repository under
 * `fb.<userId>.repo.<repositoryId>.expanded` (FB-14). They are restored parents
 * first, and only those that still exist; storage that is missing or refuses
 * access only loses the memory.
 */
@Injectable()
export class FileTreeStoreService {
  private readonly api = inject(FilesApi);
  private readonly currentUser = inject(CurrentUserService);
  private readonly transloco = inject(TranslocoService);
  /** Rows are labelled again when the language or its texts change. */
  private readonly translations = toSignal(this.transloco.selectTranslation());

  private readonly folders = signal<ReadonlyMap<string, FolderState>>(new Map());
  /** Where the expanded folders are remembered, once they have been restored. */
  private readonly memoryKey = signal<string | null>(null);

  /** The paths of the expanded folders, as `ui-tree` expands them. */
  readonly expanded = signal<readonly string[]>([]);
  /** The entry whose row the tree is asked to focus once it is shown, such as a new folder (FB-32). */
  readonly focusRequest = signal<string | null>(null);
  /** The root folder's rows, each folder's rows as its children. */
  readonly nodes = computed(() => {
    this.translations();
    return this.rows('', this.folders()) ?? [];
  });

  private repositoryId: number | undefined;
  /** Counts the repositories started, so that answers for an earlier one are ignored. */
  private generation = 0;
  private readonly requests = new Map<string, Request>();
  private readonly subscriptions = new Map<string, Subscription>();

  constructor() {
    effect(() => {
      const key = this.memoryKey();
      const expanded = this.expanded();
      if (key !== null) {
        write(key, JSON.stringify(expanded));
      }
    });
    inject(DestroyRef).onDestroy(() => this.cancelAll());
  }

  /**
   * Shows the repository `repositoryId`: lists its root folder and restores the
   * folders this device remembers as expanded. Nothing happens for the
   * repository already shown.
   */
  init(repositoryId: number): void {
    if (repositoryId === this.repositoryId) {
      return;
    }
    const generation = ++this.generation;
    this.repositoryId = repositoryId;
    this.cancelAll();
    this.folders.set(new Map());
    this.expanded.set([]);
    this.memoryKey.set(null);

    void this.fetch('');
    this.currentUser
      .load()
      .then(async user => {
        const key = `fb.${user.id}.repo.${repositoryId}.expanded`;
        await this.restore(remembered(key), generation);
        if (generation === this.generation) {
          this.memoryKey.set(key);
        }
      })
      .catch(() => undefined);
  }

  /** Lists `folder` again and replaces its rows; the rest of the tree stays as it is. */
  load(folder: string): void {
    void this.fetch(folder);
  }

  /** The entries of `folder`, listing it if needed; `null` when it cannot be listed. */
  async entries(folder: string): Promise<readonly Entry[] | null> {
    const listing = await this.listingOf(folder);
    return typeof listing === 'string' ? null : listing.entries;
  }

  /** The entry at `path`, if its folder is loaded. */
  entry(path: string): Entry | undefined {
    const { parent, name } = split(path);
    const state = this.folders().get(parent);
    return state?.status === 'loaded' ? state.listing.entries.find(item => item.name === name) : undefined;
  }

  /**
   * The entry at `path`, listing and expanding the folders that lead to it, so
   * that it is shown in the tree (FB-14). `null` when any part of it is
   * missing; `failed` when a folder on the way cannot be listed (it then
   * shows **Try again**, and the path can be resolved again).
   */
  async resolve(path: string): Promise<Entry | null | 'failed'> {
    const generation = this.generation;
    const names = path.split('/');
    let folder = '';
    let pending = this.listingOf('');
    for (const [ index, name ] of names.entries()) {
      const listing = await pending;
      if (listing === 'failed') {
        return 'failed';
      }
      if (generation !== this.generation || listing === 'missing') {
        return null;
      }
      const found = listing.entries.find(item => item.name === name);
      if (!found || index === names.length - 1) {
        return found ?? null;
      }
      if (found.kind !== 'folder') {
        return null;
      }
      folder = join(folder, name);
      // Listing starts first, so that the tree finds the folder loading and does not ask for it.
      pending = this.listingOf(folder);
      this.expand(folder);
    }
    return null;
  }

  /**
   * Follows a rename of the entry at `from` to `to` (FB-36): the loaded
   * listings and the expanded folders at and under `from` move to `to`, so
   * that a renamed folder stays as it was shown, and listings on their way
   * are asked for again at their new paths. The parent is listed again by
   * the caller.
   */
  renamed(from: string, to: string): void {
    const move = (path: string) =>
      path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
    const moved = [ ...this.folders().keys() ].filter(path => move(path) !== path);
    this.folders.update(folders => new Map([ ...folders ].map(([ path, state ]) => [ move(path), state ])));
    this.expanded.update(expanded => expanded.map(move));
    for (const path of moved) {
      const request = this.requests.get(path);
      if (request) {
        this.requests.delete(path);
        request.supersede(this.fetch(move(path)));
        this.subscriptions.delete(path);
      }
    }
  }

  /**
   * Restores the remembered folders, parents before children. A folder is
   * expanded only if its parent is and lists it as a folder; one that turns
   * out to be gone when it is listed is dropped without an error.
   */
  private async restore(paths: readonly string[], generation: number): Promise<void> {
    const byDepth = new Map<number, string[]>();
    for (const path of new Set(paths)) {
      const depth = path.split('/').length;
      byDepth.set(depth, [ ...(byDepth.get(depth) ?? []), path ]);
    }
    const levels = [ ...byDepth.entries() ].sort(([ a ], [ b ]) => a - b).map(([ , level ]) => level);
    await this.listingOf('');
    if (generation !== this.generation) {
      return;
    }

    const kept = new Set<string>();
    for (const level of levels) {
      await Promise.all(level.map(async path => {
        const { parent, name } = split(path);
        const state = this.folders().get(parent);
        if ((parent !== '' && !kept.has(parent)) || state?.status !== 'loaded') {
          return;
        }
        if (!state.listing.entries.some(item => item.kind === 'folder' && item.name === name)) {
          return;
        }
        const pending = this.listingOf(path);
        this.expand(path);
        kept.add(path);
        if ((await pending) === 'missing' && generation === this.generation) {
          kept.delete(path);
          this.expanded.update(expanded => expanded.filter(item => item !== path));
          this.setFolder(path, undefined);
        }
      }));
      if (generation !== this.generation) {
        return;
      }
    }
  }

  /** Expands `folder`, which lists it if needed. */
  expand(folder: string): void {
    if (!this.expanded().includes(folder)) {
      this.expanded.update(expanded => [ ...expanded, folder ]);
    }
  }

  /**
   * The folder's listing: the loaded one, the one on its way, or a new
   * request. A folder that failed stays failed until **Try again** (`load`).
   */
  private listingOf(folder: string): Promise<Outcome> {
    const state = this.folders().get(folder);
    if (state?.status === 'loaded') {
      return Promise.resolve(state.listing);
    }
    if (state?.status === 'error') {
      return Promise.resolve('failed');
    }
    const request = this.requests.get(folder);
    return state?.status === 'loading' && request ? request.done : this.fetch(folder);
  }

  /** Lists `folder`; only the latest request for a folder counts. */
  private fetch(folder: string): Promise<Outcome> {
    const repositoryId = this.repositoryId;
    if (repositoryId === undefined) {
      return Promise.resolve('failed');
    }
    let settle!: (outcome: Outcome | Promise<Outcome>) => void;
    const request: Request = {
      done: new Promise<Outcome>(resolve => (settle = resolve)),
      supersede: next => {
        this.subscriptions.get(folder)?.unsubscribe();
        settle(next);
      }
    };
    this.requests.get(folder)?.supersede(request.done);
    this.requests.set(folder, request);
    this.setFolder(folder, { status: 'loading' });

    const finish = (state: FolderState | undefined, outcome: Outcome) => {
      if (this.requests.get(folder) !== request) {
        return;
      }
      this.requests.delete(folder);
      this.subscriptions.delete(folder);
      this.setFolder(folder, state);
      settle(outcome);
    };
    const subscription = this.api.listFolder(repositoryId, { path: folder }).subscribe({
      next: listing => finish({ status: 'loaded', listing }, listing),
      error: (error: unknown) =>
        finish({ status: 'error' }, toApiError(error).code === 'entry-not-found' ? 'missing' : 'failed')
    });
    if (this.requests.get(folder) === request) {
      this.subscriptions.set(folder, subscription);
    }
    return request.done;
  }

  private setFolder(folder: string, state: FolderState | undefined): void {
    this.folders.update(folders => {
      const next = new Map(folders);
      if (state) {
        next.set(folder, state);
      } else {
        next.delete(folder);
      }
      return next;
    });
  }

  private cancelAll(): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.unsubscribe();
    }
    this.subscriptions.clear();
    this.requests.clear();
  }

  /** A folder's rows; undefined until it is asked for, so that `ui-tree` asks for it. */
  private rows(folder: string, folders: ReadonlyMap<string, FolderState>): TreeEntry[] | undefined {
    const state = folders.get(folder);
    if (!state) {
      return undefined;
    }
    if (state.status === 'loading') {
      return [ this.added('loading', folder, this.text('loading')) ];
    }
    if (state.status === 'error') {
      const label = this.text('loadFailed');
      // Selecting it means **Try again** (FB-44).
      return [ {
        ...this.added('error', folder, label),
        accessibleName: `${label}, ${this.text('retry')}`,
        selectable: true
      } ];
    }
    const { entries, more } = state.listing;
    const rows = entries.map(entry => this.entryRow(folder, entry, folders));
    if (more > 0) {
      rows.push(this.added('more', folder, this.text('more', { count: more })));
    }
    if (entries.length === 0 && folder !== '') {
      rows.push(this.added('empty-note', folder, this.text('emptyNote')));
    }
    return rows;
  }

  private entryRow(folder: string, entry: Entry, folders: ReadonlyMap<string, FolderState>): TreeEntry {
    const path = join(folder, entry.name);
    const isFolder = entry.kind === 'folder';
    // `<name>, <kind>[, Markdown][, ignored][, empty]`, starting with the visible name (FB-46).
    const accessibleName = [
      entry.name,
      this.text(entry.kind),
      ...(entry.markdown ? [ this.text('markdown') ] : []),
      ...(entry.ignored ? [ this.text('ignored') ] : []),
      ...(isFolder && entry.empty ? [ this.text('empty') ] : [])
    ].join(', ');
    return {
      value: path,
      label: entry.name,
      accessibleName,
      kind: entry.kind,
      entry,
      path,
      // A submodule cannot be expanded (FB-23); it can be selected to say why.
      expandable: isFolder,
      selectable: !isFolder,
      children: isFolder ? this.rows(path, folders) : undefined
    };
  }

  private added(kind: TreeEntryKind, folder: string, label: string): TreeEntry {
    return { value: `\u0000${kind}:${folder}`, label, kind, path: folder, selectable: false };
  }

  private text(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`${KEY}.${key}`, params);
  }
}

function join(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`;
}

function split(path: string): { parent: string; name: string; } {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? { parent: '', name: path } : { parent: path.slice(0, slash), name: path.slice(slash + 1) };
}

/** The remembered folder paths, or none when the memory is missing or not a list of paths. */
function remembered(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [];
  } catch {
    return [];
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Only the memory is lost.
  }
}
