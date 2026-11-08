import { HttpErrorResponse } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, type Signal, signal, type WritableSignal } from '@angular/core';
import type { ApiError, FileContent, FileState } from '@front-burner/shared-contracts';
import { injectNarrowViewport } from '@front-burner/ui';
import { FilesApi } from '@front-burner/web-api-client';
import {
  CurrentUserService,
  type Draft,
  type DraftKey,
  DraftStore,
  FileSaver,
  type SaveStatus,
  toApiError
} from '@front-burner/web-core';
import { firstValueFrom, type Observable, Subject } from 'rxjs';

import { isWithin, movedPath } from '../../utils/file-name/file-name';
import { RepositorySessionService } from '../repository-session/repository-session.service';

/** On narrow screens, a file larger than this, in bytes, opens without highlighting (ED-9a). */
export const LARGE_FILE_ON_NARROW = 102_400;

/**
 * The state of one file opened on the repository screen (A-8.15), kept for as
 * long as the page lives, so that its undo history and cursor stay when
 * another file is opened and back (ED-8).
 */
export interface OpenFile {
  /** Its path now; it follows a rename (FB-36). */
  path: WritableSignal<string>;
  /** The file as it was last loaded; a reload replaces it (ED-24). */
  file: FileContent;
  /** Counts the reloads of `file`; the editor pane builds a new state for each (ED-24). */
  revision: WritableSignal<number>;
  /** The content hash of its last load or save (ED-6, ED-24). */
  hash: WritableSignal<string>;
  /**
   * The editor pane's `EditorState`, created by the pane when it first shows
   * the file; opaque here, so that the store needs no CodeMirror code (ED-4).
   */
  editorState: unknown;
  saver: FileSaver;
  /** Whether the editor highlights it (ED-9a). */
  highlight: WritableSignal<boolean>;
  /** Whether it was larger than {@link LARGE_FILE_ON_NARROW} on a narrow screen when it was last opened. */
  largeOnNarrow: boolean;
  /** Its size in bytes as stored, after its last load or save. */
  size: number;
  /**
   * The browser draft found when it was opened, offered until the user
   * restores or discards it; meanwhile the editor is read-only (ED-7).
   */
  draft: WritableSignal<Draft | null>;
  /**
   * The content hash of a change on disk made while it had unsaved edits,
   * until the user chooses **Reload** or **Keep mine** (ED-24); meanwhile
   * nothing is saved.
   */
  changed: WritableSignal<string | null>;
  /**
   * Whether it was deleted or renamed elsewhere (ED-21, FB-42). With unsaved
   * edits it stays open, read-only, until **Recreate it**; meanwhile nothing
   * is saved.
   */
  gone: WritableSignal<boolean>;
  /** Why the last **Recreate it** failed, such as `entry-exists`. */
  recreateError: WritableSignal<ApiError | null>;
  /**
   * What its live preview shows (A-8.12). The editor pane bumps `version` on
   * every change of the text and sets `read` to read the editor's content
   * once it shows the file; until then it reads the loaded content.
   */
  preview: { version: WritableSignal<number>; read: () => string; };
}

/** How long after its answer a save's hash still counts as this tab's own, for its late event (A-3.11). */
export const OWN_SAVE_MS = 5000;

/** The save status of a file that waits for the user's choice after a change on disk. */
const NOT_SAVED: SaveStatus = {
  kind: 'refused',
  code: 'changed-on-disk',
  error: { code: 'changed-on-disk', params: {}, requestId: '', message: 'changed-on-disk' }
};

/**
 * The files opened on the repository screen, one {@link OpenFile} per
 * repository and path (A-8.15), of which one is the current file (ED-3).
 * Provided by the page.
 *
 * Each file's saver sends `saveFile` to the file's current path with the line
 * ending and byte order mark it was loaded with (ED-12).
 *
 * Unsaved content is kept as a browser draft (ED-20, A-8.10): written each
 * time a saver sends it, and by `writeDrafts` when the page is hidden for
 * good; deleted once the backend holds the newest content, whether a save
 * confirmed it or the edits were undone back to it. Opening a file looks for
 * its draft and offers it (ED-7); one equal to the file is deleted without
 * asking. A file another tab has open is claimed by it, and its draft, still
 * being saved there, is neither offered nor deleted (D-1.3). Deleting from this tab's file tree deletes the drafts
 * (FB-39), and renaming moves them (FB-36); a file that is gone for any other
 * reason keeps its draft (FB-42, ED-21).
 *
 * A change on disk made elsewhere, found by `DiskChangesService`, is followed
 * here (ED-24): `reload` loads the new content, `changedOnDisk` waits for
 * **Reload** or **Keep mine**, and `markGone` for **Recreate it** (ED-21).
 * While a file waits for the user, its saver is held and its unsaved
 * content kept as its browser draft.
 */
@Injectable()
export class OpenFilesService {
  private readonly api = inject(FilesApi);
  private readonly session = inject(RepositorySessionService);
  private readonly narrow = injectNarrowViewport();
  private readonly drafts = inject(DraftStore);
  private readonly currentUser = inject(CurrentUserService);

  /** By repository, then by path. */
  private readonly files = new Map<number, Map<string, OpenFile>>();
  /** Every entry, so that `anyUnsaved` follows them. */
  private readonly all = signal<readonly OpenFile[]>([]);
  private readonly currentFile = signal<OpenFile | null>(null);
  /** Counts the files opened, so that only the latest one becomes the current one. */
  private opening = 0;
  /** Releases each entry's claim on its draft. */
  private readonly claims = new Map<OpenFile, () => void>();
  /** Releases the saver of each entry that waits for the user's choice after a change on disk. */
  private readonly waits = new Map<OpenFile, () => void>();
  /** The hashes of each entry's saves answered in the last {@link OWN_SAVE_MS}, with when. */
  private readonly ownSaves = new WeakMap<OpenFile, { hash: string; at: number; }[]>();
  private readonly missingSubject = new Subject<string>();
  private readonly recreatedSubject = new Subject<string>();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.claims.forEach(release => release()));
  }

  /** The file shown in the editor, once it has opened. */
  readonly current: Signal<OpenFile | null> = this.currentFile.asReadonly();
  /** Whether any file has edits the backend has not confirmed. */
  readonly anyUnsaved = computed(() => this.all().some(file => file.saver.unsaved()));
  /** The path of each file whose save the backend refused because the file does not exist (ED-21). */
  readonly missing: Observable<string> = this.missingSubject.asObservable();
  /** The path of each file that **Recreate it** created again (ED-21). */
  readonly recreated: Observable<string> = this.recreatedSubject.asObservable();

  /**
   * Opens the file at `path` of the open repository and makes it the current
   * file, reusing the entry kept from an earlier opening (ED-8). Rejects with
   * the `ApiError` when it cannot be read, such as `file-too-large` (FB-21).
   * Each opening starts a large file on a narrow screen without highlighting
   * again (ED-9a). The entry of a file gone elsewhere without unsaved edits
   * is not reused: the file is read again.
   */
  async open(path: string): Promise<OpenFile> {
    const opening = ++this.opening;
    const repositoryId = this.repositoryId();
    let file = this.get(path);
    if (file?.gone() && !file.saver.unsaved()) {
      this.forget(file, repositoryId);
      file = undefined;
    }
    if (!file) {
      this.currentFile.set(null);
      let content: FileContent;
      try {
        content = await firstValueFrom(this.api.readFile(repositoryId, { path }));
      } catch (error) {
        if (opening === this.opening) {
          this.currentFile.set(null);
        }
        throw toApiError(error);
      }
      const key = await this.draftKey(repositoryId, content.path);
      let draft = key && !(await this.drafts.claimedElsewhere(key)) ? await this.drafts.get(key) : null;
      if (key && draft?.content === content.content) {
        void this.drafts.delete(key);
        draft = null;
      }
      // Opened meanwhile by another call.
      file = this.byPath(repositoryId).get(path) ?? this.create(repositoryId, content, draft);
    }
    file.largeOnNarrow = this.narrow() && file.size > LARGE_FILE_ON_NARROW;
    file.highlight.set(!file.largeOnNarrow);
    if (opening === this.opening) {
      this.currentFile.set(file);
    }
    return file;
  }

  /** The entry of the open repository's file at `path`, if it was opened. */
  get(path: string): OpenFile | undefined {
    const repositoryId = this.session.repository()?.id;
    return repositoryId === undefined ? undefined : this.files.get(repositoryId)?.get(path);
  }

  /** Sends every waiting save at once and resolves when they are done (ED-17, FB-36). */
  async flushAll(): Promise<void> {
    await Promise.all(this.all().map(file => file.saver.flush()));
  }

  /**
   * Writes the waiting content of every file as its browser draft, such as
   * when the page is hidden for good; the content of a save in flight was
   * written when it was sent.
   */
  writeDrafts(): void {
    for (const [ repositoryId, files ] of this.files) {
      for (const file of files.values()) {
        const waiting = file.saver.waiting();
        if (waiting !== null) {
          this.putDraft(file, repositoryId, waiting);
        }
      }
    }
  }

  /**
   * Restores the file's offered draft (ED-7): `apply` puts the draft's content
   * in the editor and returns what reads the editor's content, which is saved
   * at once. `apply` is not called when no draft is offered. The draft is kept
   * until that save is confirmed.
   */
  restoreDraft(path: string, apply: (content: string) => () => string): void {
    const file = this.get(path);
    const draft = file?.draft();
    if (!file || !draft) {
      return;
    }
    file.draft.set(null);
    file.saver.edit(apply(draft.content));
    void file.saver.flush();
  }

  /** Deletes the file's offered draft and leaves the file as it is on disk (ED-7). */
  discardDraft(path: string): void {
    const file = this.get(path);
    if (!file || file.draft() === null) {
      return;
    }
    file.draft.set(null);
    const key = this.keyAt(this.repositoryId(), file.path());
    if (key) {
      void this.drafts.delete(key);
    }
  }

  /**
   * Before the file at `path` is discarded (GA-24): drops its waiting save and
   * its browser draft, offered or not, and holds its saver. Resolves, once a save
   * in flight has been answered, so that none can land after the discard, with
   * what ends the hold: `release` when the file was discarded, and `restore` when
   * it was not, which offers the draft again and saves the editor's content again.
   * `null` when the file is not open.
   */
  async dropForDiscard(path: string): Promise<{ release(): void; restore(): void; } | null> {
    const file = this.get(path);
    if (!file) {
      return null;
    }
    const repositoryId = this.repositoryId();
    const release = file.saver.hold();
    const unsaved = file.saver.unsaved();
    const offered = file.draft();
    file.draft.set(null);
    file.saver.discard();
    await file.saver.settled();
    const key = this.keyAt(repositoryId, file.path());
    // With nothing of its own to drop, a draft here is another tab's, still being saved there (D-1.3).
    if (key && (unsaved || offered !== null || !(await this.drafts.claimedByAnotherTab(key)))) {
      await this.drafts.delete(key);
    }
    return {
      release,
      restore: () => {
        if (offered) {
          file.draft.set(offered);
          if (key) {
            void this.drafts.put(key, offered);
          }
        }
        if (unsaved) {
          file.saver.edit(file.preview.read);
          if (this.waits.has(file)) {
            this.wait(file, repositoryId);
          } else {
            void file.saver.flush();
          }
        }
        release();
      }
    };
  }

  /** Deletes the browser drafts at `paths`, of files not open here, except those another tab has open (D-1.3). */
  async deleteDrafts(repositoryId: number, paths: readonly string[]): Promise<void> {
    await this.drafts.deleteUnclaimed(paths.flatMap(path => this.keyAt(repositoryId, path) ?? []));
  }

  /**
   * Whether `hash` is the content of `file` as this tab knows it: its last
   * load or save, or a save of this tab answered in the last
   * {@link OWN_SAVE_MS}, whose event can come after a newer save's answer.
   */
  isOwnSave(file: OpenFile, hash: string): boolean {
    const since = Date.now() - OWN_SAVE_MS;
    return hash === file.hash() || (this.ownSaves.get(file) ?? []).some(save => save.hash === hash && save.at >= since);
  }

  /**
   * The save status shown for `file` (ED-18): "Not saved" while it waits for
   * the user's choice after a change on disk (ED-21, ED-24).
   */
  statusOf(file: OpenFile): SaveStatus {
    return (file.gone() || file.changed() !== null) && file.saver.unsaved()
      ? NOT_SAVED
      : file.saver.status();
  }

  /** The paths of the repository's files with edits the backend has not confirmed. */
  unsavedPaths(repositoryId: number): string[] {
    this.all();
    return [ ...this.files.get(repositoryId)?.values() ?? [] ]
      .filter(file => file.saver.unsaved())
      .map(file => file.path());
  }

  /**
   * Why the newest edits of the first of `paths` that has any did not reach the
   * disk, after a flush: its save failed, it waits for the user, or it is held,
   * as during a rename (GA-20). A file that is only being typed in does not count,
   * as its edits came after the flush.
   */
  notSaved(repositoryId: number, paths: readonly string[]): { error: ApiError; retry: boolean; } | null {
    this.all();
    const named = (code: string, path: string): ApiError => ({ code, params: { path }, requestId: '', message: code });
    for (const path of paths) {
      const file = this.files.get(repositoryId)?.get(path);
      if (file === undefined) {
        continue;
      }
      if (file.gone() && file.saver.unsaved()) {
        return { error: named('file-gone', path), retry: false };
      }
      if (file.changed() !== null && file.saver.unsaved()) {
        return { error: named('changed-on-disk', path), retry: false };
      }
      if (file.saver.held()) {
        return { error: named('file-held', path), retry: true };
      }
      const status = file.saver.status();
      if (status.kind === 'refused') {
        return { error: status.error, retry: false };
      }
      if (status.kind === 'offline') {
        return { error: toApiError(new HttpErrorResponse({ status: 0 })), retry: true };
      }
    }
    return null;
  }

  /**
   * Loads the file at `path` again from disk (ED-24): the editor pane shows
   * the new content, the undo history starts again, and the unsaved edits and
   * their browser draft are dropped. Without `discard`, nothing changes when
   * the file has unsaved edits once it is read, such as when the user typed
   * meanwhile, and it resolves `false`. A file not found is marked gone.
   * Rejects with the `ApiError` of any other failure. With `keepDraft`, the
   * browser draft is left as it is, as `dropForDiscard` has dealt with it.
   */
  async reload(path: string, options: { discard: boolean; keepDraft?: boolean; }): Promise<boolean> {
    const file = this.get(path);
    if (!file) {
      return false;
    }
    const repositoryId = this.repositoryId();
    let content: FileContent;
    try {
      content = await firstValueFrom(this.api.readFile(repositoryId, { path: file.path() }));
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === 'entry-not-found') {
        this.markGone(file.path());
        return false;
      }
      throw apiError;
    }
    if (!options.discard && file.saver.unsaved()) {
      return false;
    }
    file.saver.discard();
    file.saver.rebase(content.content, content.hash);
    file.file = content;
    file.size = content.size;
    this.settle(file, repositoryId, content, options.keepDraft);
    file.revision.update(revision => revision + 1);
    return true;
  }

  /**
   * Loads again the file at `path`, whose edits `dropForDiscard` dropped. When
   * that fails, the editor still shows what was dropped, and a save would bring it
   * back: the file waits for **Reload**, as after any change on disk (ED-24), or
   * for the next event to load it. Resolves whether it did not fail.
   */
  async reloadDropped(path: string): Promise<boolean> {
    try {
      await this.reload(path, { discard: true, keepDraft: true });
      return true;
    } catch {
      const file = this.get(path);
      if (file) {
        this.changedOnDisk(path, file.hash());
      }
      return false;
    }
  }

  /**
   * The file at `path`, which has unsaved edits, changed on disk to content
   * with `hash` (ED-24): its saver waits until **Reload** or **Keep mine**.
   */
  changedOnDisk(path: string, hash: string): void {
    const file = this.get(path);
    if (file) {
      file.gone.set(false);
      file.changed.set(hash);
      this.wait(file);
    }
  }

  /**
   * **Keep mine** (ED-24, D-1.3): the content `content` reads is saved at
   * once over the change on disk. Its browser draft is kept until the save is
   * confirmed.
   */
  keepMine(path: string, content: () => string): void {
    const file = this.get(path);
    const hash = file?.changed();
    if (!file || hash === null || hash === undefined) {
      return;
    }
    file.changed.set(null);
    file.recreateError.set(null);
    file.hash.set(hash);
    // Whatever the editor holds now differs from the disk.
    file.saver.rebase(null, hash);
    this.endWait(file);
    file.saver.edit(content);
    void file.saver.flush();
  }

  /**
   * The file at `path` was deleted or renamed elsewhere (ED-21, FB-42). With
   * unsaved edits, its saver waits for **Recreate it** and its content is kept
   * as its browser draft.
   */
  markGone(path: string): void {
    const file = this.get(path);
    if (!file) {
      return;
    }
    file.changed.set(null);
    file.gone.set(true);
    if (file.saver.unsaved()) {
      this.wait(file);
    }
  }

  /**
   * **Recreate it** (ED-21): creates the file gone elsewhere at its path again
   * with the content `content` reads. Once that is confirmed, the file is
   * saved as usual again and its browser draft is deleted; when it fails, such
   * as with `entry-exists` because the file came back meanwhile,
   * `recreateError` says why and the content and the draft stay.
   */
  async recreate(path: string, content: () => string): Promise<void> {
    const file = this.get(path);
    if (!file?.gone()) {
      return;
    }
    const repositoryId = this.repositoryId();
    const text = content();
    file.recreateError.set(null);
    let state: FileState;
    try {
      state = await firstValueFrom(this.api.recreateFile(repositoryId, {
        path: file.path(),
        content: text,
        lineEnding: file.file.lineEnding,
        bom: file.file.bom
      }));
    } catch (error) {
      file.recreateError.set(toApiError(error));
      return;
    }
    file.saver.discard();
    file.saver.rebase(text, state.hash);
    file.size = state.size;
    this.settle(file, repositoryId, state);
    this.recreatedSubject.next(file.path());
  }

  /** Keeps every file's saver from sending until the returned function is called, such as during a rename. */
  hold(): () => void {
    const releases = this.all().map(file => file.saver.hold());
    return () => releases.forEach(release => release());
  }

  /** Makes the file shown in the editor none, such as when the route names another kind of entry. */
  clearCurrent(): void {
    this.opening++;
    this.currentFile.set(null);
  }

  /**
   * Moves the entry at `from`, or every entry under the folder at `from`, to
   * its path under `to`, keeping its state (FB-36, ED-8), and their browser
   * drafts with them, also those of files not opened.
   */
  rekey(from: string, to: string): void {
    const repositoryId = this.repositoryId();
    const fromKey = this.keyAt(repositoryId, from);
    const toKey = this.keyAt(repositoryId, to);
    if (fromKey && toKey) {
      void this.drafts.move(fromKey, toKey);
    }
    const files = this.byPath(repositoryId);
    for (const [ path, file ] of [ ...files ]) {
      const moved = movedPath(path, from, to);
      if (moved !== null && moved !== path) {
        files.delete(path);
        files.set(moved, file);
        file.path.set(moved);
        this.claim(file, repositoryId);
      }
    }
  }

  /**
   * Forgets the entry at `path`, or every entry under the folder at `path`,
   * such as after a delete; with `dropPending` its waiting save is dropped and
   * the browser drafts at `path` are deleted, also those of files not opened
   * (FB-39); otherwise the waiting save is sent first. With `keepDraft`, the
   * browser drafts are left as they are, as `dropForDiscard` has dealt with them.
   */
  close(path: string, options: { dropPending: boolean; keepDraft?: boolean; }): void {
    const repositoryId = this.repositoryId();
    const draftKey = this.keyAt(repositoryId, path);
    if (options.dropPending && !options.keepDraft && draftKey) {
      void this.drafts.delete(draftKey);
    }
    const files = this.byPath(repositoryId);
    for (const [ key, file ] of [ ...files ]) {
      if (!isWithin(key, path)) {
        continue;
      }
      if (options.dropPending) {
        file.saver.discard();
      } else {
        void file.saver.flush();
      }
      this.forget(file, repositoryId);
      if (this.currentFile() === file) {
        this.clearCurrent();
      }
    }
  }

  /** Removes the entry of `file`, releasing its claim on its draft. */
  private forget(file: OpenFile, repositoryId: number): void {
    this.byPath(repositoryId).delete(file.path());
    this.claims.get(file)?.();
    this.claims.delete(file);
    this.endWait(file);
    this.all.update(all => all.filter(item => item !== file));
  }

  /** Holds the saver of `file` until the user chooses, keeping its waiting content as its browser draft. */
  private wait(file: OpenFile, repositoryId = this.repositoryId()): void {
    if (!this.waits.has(file)) {
      this.waits.set(file, file.saver.hold());
    }
    const waiting = file.saver.waiting();
    if (waiting !== null) {
      this.putDraft(file, repositoryId, waiting);
    }
  }

  private endWait(file: OpenFile): void {
    this.waits.get(file)?.();
    this.waits.delete(file);
  }

  /** After a reload or a recreate: the disk holds `state`, and nothing waits for the user any more. */
  private settle(file: OpenFile, repositoryId: number, state: FileState, keepDraft = false): void {
    file.hash.set(state.hash);
    file.changed.set(null);
    file.gone.set(false);
    file.recreateError.set(null);
    this.endWait(file);
    const key = this.keyAt(repositoryId, file.path());
    if (key && !keepDraft) {
      void this.drafts.delete(key);
    }
  }

  private create(repositoryId: number, content: FileContent, draft: Draft | null): OpenFile {
    const path = signal(content.path);
    const file: OpenFile = {
      path,
      file: content,
      hash: signal(content.hash),
      editorState: null,
      revision: signal(0),
      saver: new FileSaver({
        lastSaved: content.content,
        send: async text => {
          let state: FileState;
          try {
            state = await firstValueFrom(this.api.saveFile(repositoryId, {
              path: path(),
              content: text,
              lineEnding: file.file.lineEnding,
              bom: file.file.bom
            }));
          } catch (error) {
            if (toApiError(error).code === 'entry-not-found') {
              this.missingSubject.next(path());
            }
            throw error;
          }
          file.hash.set(state.hash);
          file.size = state.size;
          const since = Date.now() - OWN_SAVE_MS;
          this.ownSaves.set(file, [
            ...(this.ownSaves.get(file) ?? []).filter(save => save.at >= since),
            { hash: state.hash, at: Date.now() }
          ]);
          return { hash: state.hash };
        }
      }),
      highlight: signal(true),
      largeOnNarrow: false,
      size: content.size,
      draft: signal(draft),
      changed: signal(null),
      gone: signal(false),
      recreateError: signal(null),
      preview: { version: signal(0), read: () => file.file.content }
    };
    file.saver.sending.subscribe(text => this.putDraft(file, repositoryId, text));
    file.saver.upToDate.subscribe(() => {
      const key = this.keyAt(repositoryId, file.path());
      if (key) {
        void this.drafts.delete(key);
      }
    });
    this.claim(file, repositoryId);
    this.byPath(repositoryId).set(content.path, file);
    this.all.update(all => [ ...all, file ]);
    return file;
  }

  /** The draft key of the file at `path`, once the user is known; `null` if they cannot be loaded. */
  private async draftKey(repositoryId: number, path: string): Promise<DraftKey | null> {
    try {
      const { id } = await this.currentUser.load();
      return { userId: id, repositoryId, path };
    } catch {
      return null;
    }
  }

  /** The draft key of the file at `path`, once the user is known. */
  private keyAt(repositoryId: number, path: string): DraftKey | null {
    const userId = this.currentUser.user()?.id;
    return userId === undefined ? null : { userId, repositoryId, path };
  }

  private putDraft(file: OpenFile, repositoryId: number, content: string): void {
    const key = this.keyAt(repositoryId, file.path());
    if (key) {
      void this.drafts.put(key, { content, savedAt: new Date().toISOString() });
    }
  }

  /** Claims the draft of `file` at its current path, releasing its claim on an earlier one. */
  private claim(file: OpenFile, repositoryId: number): void {
    this.claims.get(file)?.();
    const key = this.keyAt(repositoryId, file.path());
    this.claims.set(file, key ? this.drafts.claim(key) : () => undefined);
  }

  private byPath(repositoryId: number): Map<string, OpenFile> {
    let files = this.files.get(repositoryId);
    if (!files) {
      files = new Map();
      this.files.set(repositoryId, files);
    }
    return files;
  }

  private repositoryId(): number {
    const repository = this.session.repository();
    if (!repository) {
      throw new Error('No repository is open');
    }
    return repository.id;
  }
}
