import { computed, inject, Injectable, type Signal, signal, type WritableSignal } from '@angular/core';
import type { FileContent } from '@front-burner/shared-contracts';
import { injectNarrowViewport } from '@front-burner/ui';
import { FilesApi } from '@front-burner/web-api-client';
import { CurrentUserService, type Draft, type DraftKey, DraftStore, FileSaver, toApiError } from '@front-burner/web-core';
import { firstValueFrom } from 'rxjs';

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
  /** The file as it was loaded. */
  file: FileContent;
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
}

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
 * good; deleted when a save confirms the newest content. Opening a file looks
 * for its draft and offers it (ED-7); one equal to the file is deleted
 * without asking. Deleting from this tab's file tree deletes the drafts
 * (FB-39), and renaming moves them (FB-36); a file that is gone for any other
 * reason keeps its draft (FB-42, ED-21).
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

  /** The file shown in the editor, once it has opened. */
  readonly current: Signal<OpenFile | null> = this.currentFile.asReadonly();
  /** Whether any file has edits the backend has not confirmed. */
  readonly anyUnsaved = computed(() => this.all().some(file => file.saver.unsaved()));

  /**
   * Opens the file at `path` of the open repository and makes it the current
   * file, reusing the entry kept from an earlier opening (ED-8). Rejects with
   * the `ApiError` when it cannot be read, such as `file-too-large` (FB-21).
   * Each opening starts a large file on a narrow screen without highlighting
   * again (ED-9a).
   */
  async open(path: string): Promise<OpenFile> {
    const opening = ++this.opening;
    const repositoryId = this.repositoryId();
    let file = this.get(path);
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
      let draft = key ? await this.drafts.get(key) : null;
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
        const key = this.draftKeyNow(file, repositoryId);
        if (waiting !== null && key) {
          void this.drafts.put(key, { content: waiting, savedAt: new Date().toISOString() });
        }
      }
    }
  }

  /**
   * Restores the file's offered draft (ED-7): the editor has put it in its
   * content, which `content` reads; it is saved at once. The draft is kept
   * until that save is confirmed.
   */
  restoreDraft(path: string, content: () => string): void {
    const file = this.get(path);
    if (!file || file.draft() === null) {
      return;
    }
    file.draft.set(null);
    file.saver.edit(content);
    void file.saver.flush();
  }

  /** Deletes the file's offered draft and leaves the file as it is on disk (ED-7). */
  discardDraft(path: string): void {
    const file = this.get(path);
    if (!file || file.draft() === null) {
      return;
    }
    file.draft.set(null);
    const key = this.draftKeyNow(file, this.repositoryId());
    if (key) {
      void this.drafts.delete(key);
    }
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
    const userId = this.currentUser.user()?.id;
    if (userId !== undefined) {
      void this.drafts.move({ userId, repositoryId, path: from }, { userId, repositoryId, path: to });
    }
    const files = this.byPath(repositoryId);
    for (const [ path, file ] of [ ...files ]) {
      const moved = movedPath(path, from, to);
      if (moved !== null && moved !== path) {
        files.delete(path);
        files.set(moved, file);
        file.path.set(moved);
      }
    }
  }

  /**
   * Forgets the entry at `path`, or every entry under the folder at `path`,
   * such as after a delete; with `dropPending` its waiting save is dropped and
   * the browser drafts at `path` are deleted, also those of files not opened
   * (FB-39); otherwise the waiting save is sent first.
   */
  close(path: string, options: { dropPending: boolean; }): void {
    const repositoryId = this.repositoryId();
    const userId = this.currentUser.user()?.id;
    if (options.dropPending && userId !== undefined) {
      void this.drafts.delete({ userId, repositoryId, path });
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
      files.delete(key);
      this.all.update(all => all.filter(item => item !== file));
      if (this.currentFile() === file) {
        this.clearCurrent();
      }
    }
  }

  private create(repositoryId: number, content: FileContent, draft: Draft | null): OpenFile {
    const path = signal(content.path);
    const file: OpenFile = {
      path,
      file: content,
      hash: signal(content.hash),
      editorState: null,
      saver: new FileSaver({
        lastSaved: content.content,
        send: async text => {
          const state = await firstValueFrom(this.api.saveFile(repositoryId, {
            path: path(),
            content: text,
            lineEnding: content.lineEnding,
            bom: content.bom
          }));
          file.hash.set(state.hash);
          file.size = state.size;
          return { hash: state.hash };
        }
      }),
      highlight: signal(true),
      largeOnNarrow: false,
      size: content.size,
      draft: signal(draft)
    };
    file.saver.sending.subscribe(text => {
      const key = this.draftKeyNow(file, repositoryId);
      if (key) {
        void this.drafts.put(key, { content: text, savedAt: new Date().toISOString() });
      }
    });
    file.saver.saved.subscribe(() => {
      const key = this.draftKeyNow(file, repositoryId);
      // Not when newer content waits: its draft is the only copy of it.
      if (key && !file.saver.unsaved()) {
        void this.drafts.delete(key);
      }
    });
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

  /** The draft key of `file` at its current path, once the user is known. */
  private draftKeyNow(file: OpenFile, repositoryId: number): DraftKey | null {
    const userId = this.currentUser.user()?.id;
    return userId === undefined ? null : { userId, repositoryId, path: file.path() };
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
