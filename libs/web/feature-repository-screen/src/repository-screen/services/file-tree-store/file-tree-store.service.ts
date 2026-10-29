import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import type { Entry, FolderListing } from '@front-burner/shared-contracts';
import { FilesApi } from '@front-burner/web-api-client';
import { CurrentUserService, toApiError } from '@front-burner/web-core';
import { TranslocoService } from '@jsverse/transloco';
import type { Subscription } from 'rxjs';

import type { TreeEntry, TreeEntryKind } from '../../models/tree-entry.model';
import { fileName, joinPath, movedPath, parentPath } from '../../utils/file-name/file-name';

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
 * A folder that lists only its first entries (FB-18) also shows the entries
 * this client created or renamed in it that are not among them, after the
 * listed ones, so that they can be found and opened (`known`).
 *
 * An entry marked as deleting (`markDeleting`) shows "Deleting…", cannot be
 * selected or expanded, and keeps the mark when its folder is listed again,
 * until it is cleared (FB-40).
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
  /** The entries made by this client, by folder, for folders that do not list them (FB-18). */
  private readonly extras = signal<ReadonlyMap<string, readonly Entry[]>>(new Map());
  /** The paths of the entries being deleted (FB-40). */
  private readonly deleting = signal<ReadonlySet<string>>(new Set());
  /** Where the expanded folders are remembered, once they have been restored. */
  private readonly memoryKey = signal<string | null>(null);

  /** The paths of the expanded folders, as `ui-tree` expands them. */
  readonly expanded = signal<readonly string[]>([]);
  /** The entry whose row the tree is asked to focus once it is shown, such as a new folder (FB-32). */
  readonly focusRequest = signal<string | null>(null);
  /** The root folder's rows, each folder's rows as its children. */
  readonly nodes = computed(() => {
    this.translations();
    this.deleting();
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
    this.extras.set(new Map());
    this.deleting.set(new Set());
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

  /**
   * Lists `folder` again and replaces its rows; the rest of the tree stays as
   * it is. Resolves once the folder is listed, or could not be.
   */
  async load(folder: string): Promise<void> {
    await this.fetch(folder);
  }

  /**
   * The listing of `folder`, listing it if needed, with the entries this
   * client made in it (`known`); `null` when it cannot be listed.
   */
  async listing(folder: string): Promise<FolderListing | null> {
    const listing = await this.listingOf(folder);
    return typeof listing === 'string' ? null : this.withExtras(folder, listing, this.extras());
  }

  /** The entries of `folder`, as `listing` gives them; `null` when it cannot be listed. */
  async entries(folder: string): Promise<readonly Entry[] | null> {
    return (await this.listing(folder))?.entries ?? null;
  }

  /** The entry at `path`, if its folder is loaded. */
  entry(path: string): Entry | undefined {
    const state = this.folders().get(parentPath(path));
    const name = fileName(path);
    return state?.status === 'loaded'
      ? this.withExtras(parentPath(path), state.listing, this.extras()).entries.find(item => item.name === name)
      : undefined;
  }

  /**
   * Remembers the entry this client has just made at `path`, so that it is
   * shown and found even when its folder lists only its first entries (FB-18).
   * It is not shown while the folder's listing has it, or lists everything.
   */
  known(path: string, entry: Entry): void {
    const folder = parentPath(path);
    this.extras.update(extras => {
      const next = new Map(extras);
      const others = (extras.get(folder) ?? []).filter(item => item.name !== entry.name);
      next.set(folder, [ ...others, entry ]);
      return next;
    });
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
      const found = this.withExtras(folder, listing, this.extras()).entries.find(item => item.name === name);
      if (!found || index === names.length - 1) {
        return found ?? null;
      }
      if (found.kind !== 'folder') {
        return null;
      }
      folder = joinPath(folder, name);
      // Listing starts first, so that the tree finds the folder loading and does not ask for it.
      pending = this.listingOf(folder);
      this.expand(folder);
    }
    return null;
  }

  /**
   * Follows a rename of the entry at `from` to `to` (FB-36): the expanded
   * folders at and under `from` stay expanded at their new paths, so that a
   * renamed folder stays as it was shown, and so do the entries this client
   * made in them. Their listings are dropped, not moved: whether git ignores
   * an entry can change with its path (FB-31), so the tree lists them again.
   * The parent is listed again by the caller.
   */
  renamed(from: string, to: string): void {
    const gone = [ ...this.folders().keys() ].filter(path => movedPath(path, from, to) !== null);
    for (const path of gone) {
      const request = this.requests.get(path);
      if (request) {
        this.requests.delete(path);
        request.supersede(Promise.resolve('missing'));
        this.subscriptions.delete(path);
      }
      this.setFolder(path, undefined);
    }
    this.extras.update(extras => {
      const next = new Map<string, readonly Entry[]>();
      for (const [ folder, entries ] of extras) {
        // The renamed entry itself is made known again by the caller, under its new name.
        next.set(movedPath(folder, from, to) ?? folder, entries.filter(item => joinPath(folder, item.name) !== from));
      }
      return next;
    });
    this.expanded.update(expanded => expanded.map(path => movedPath(path, from, to) ?? path));
  }

  /** Marks the entry at `path` as being deleted, or clears the mark (FB-40). */
  markDeleting(path: string, deleting: boolean): void {
    this.deleting.update(paths => {
      const next = new Set(paths);
      if (deleting) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }

  /**
   * Forgets the deleted entry at `path` and everything under it: the listings
   * and expanded folders, the entries this client made there, and the
   * deleting mark. The parent is listed again by the caller.
   */
  deleted(path: string): void {
    const under = (item: string) => item === path || item.startsWith(`${path}/`);
    for (const folder of [ ...this.folders().keys() ].filter(under)) {
      const request = this.requests.get(folder);
      if (request) {
        this.requests.delete(folder);
        request.supersede(Promise.resolve('missing'));
        this.subscriptions.delete(folder);
      }
      this.setFolder(folder, undefined);
    }
    this.extras.update(extras => {
      const next = new Map<string, readonly Entry[]>();
      for (const [ folder, entries ] of extras) {
        if (!under(folder)) {
          next.set(folder, entries.filter(item => joinPath(folder, item.name) !== path));
        }
      }
      return next;
    });
    this.expanded.update(expanded => expanded.filter(item => !under(item)));
    this.markDeleting(path, false);
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
        const parent = parentPath(path);
        const name = fileName(path);
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
    const { entries, more } = this.withExtras(folder, state.listing, this.extras());
    const rows = entries.map(entry => this.entryRow(folder, entry, folders));
    if (more > 0) {
      rows.push(this.added('more', folder, this.text('more', { count: more })));
    }
    if (entries.length === 0 && folder !== '') {
      rows.push(this.added('empty-note', folder, this.text('emptyNote')));
    }
    return rows;
  }

  /**
   * A listing with the entries this client made in its folder that it does
   * not have, after the listed ones, and those no longer counted as not shown.
   * A listing of every entry is the truth: it gets none.
   */
  private withExtras(
    folder: string,
    listing: FolderListing,
    extras: ReadonlyMap<string, readonly Entry[]>
  ): FolderListing {
    if (listing.more === 0) {
      return listing;
    }
    const listed = new Set(listing.entries.map(item => item.name));
    const added = (extras.get(folder) ?? []).filter(item => !listed.has(item.name));
    return added.length === 0
      ? listing
      : { ...listing, entries: [ ...listing.entries, ...added ], more: Math.max(0, listing.more - added.length) };
  }

  private entryRow(folder: string, entry: Entry, folders: ReadonlyMap<string, FolderState>): TreeEntry {
    const path = joinPath(folder, entry.name);
    const deleting = this.deleting().has(path);
    // A folder being deleted shows nothing inside it, so that nothing there is acted on.
    const isFolder = entry.kind === 'folder' && !deleting;
    // `<name>, <kind>[, Markdown][, ignored][, empty]`, starting with the visible name (FB-46).
    const accessibleName = [
      entry.name,
      this.text(entry.kind),
      ...(entry.markdown ? [ this.text('markdown') ] : []),
      ...(entry.ignored ? [ this.text('ignored') ] : []),
      ...(isFolder && entry.empty ? [ this.text('empty') ] : []),
      ...(deleting ? [ this.text('deleting') ] : [])
    ].join(', ');
    return {
      value: path,
      label: entry.name,
      accessibleName,
      kind: entry.kind,
      entry,
      path,
      deleting,
      // A submodule cannot be expanded (FB-23); it can be selected to say why.
      expandable: isFolder,
      selectable: !isFolder && !deleting,
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
