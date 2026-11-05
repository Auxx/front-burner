import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import type { ApiError, GitStatus } from '@front-burner/shared-contracts';
import { GitApi } from '@front-burner/web-api-client';
import { type ApiErrorText, ApiErrorTextService, isRefusal, toApiError } from '@front-burner/web-core';
import { firstValueFrom } from 'rxjs';

import { CommitTicksService } from '../commit-ticks/commit-ticks.service';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';

/** A failed commit, as the form shows it (GA-43). */
export interface CommitFailure extends ApiErrorText {
  /** Whether it was passing, so that **Try again** can help. */
  readonly retry: boolean;
}

/**
 * Commits the ticked files of **Changes** (GA-19 to GA-21). Provided by the page,
 * so that the message stays while the user moves between Files and Changes; a
 * repository starts with an empty form.
 *
 * The files are those the button named when it was pressed: the ticked ones, and
 * an open file with unsaved edits that the list does not show yet, since a status
 * is read only seconds after a save. The waiting saves are sent first (GA-20), and
 * a ticked file whose newest edits did not reach the disk stops the commit, since
 * it must contain what the user sees; also when the user has left the repository.
 *
 * The committed files are not offered again until a newer status has been read,
 * which may fail or wait behind another read. A failure is shown until the
 * message, the files or what stopped their saves change, as it may no longer be
 * true then.
 */
@Injectable()
export class CommitService {
  private readonly api = inject(GitApi);
  private readonly store = inject(GitStatusStore);
  private readonly ticks = inject(CommitTicksService);
  private readonly openFiles = inject(OpenFilesService);
  private readonly session = inject(RepositorySessionService);
  private readonly errorText = inject(ApiErrorTextService);

  /** The repositories with a commit running, as each form is free of the others'. */
  private readonly running = signal<ReadonlySet<number>>(new Set());
  private readonly failure = signal<{ shown: CommitFailure; state: string; } | null>(null);
  /** The last commit's files, and the status that still lists them. */
  private readonly committed = signal<{ status: GitStatus | null; paths: ReadonlySet<string>; } | null>(null);

  /** The text of the message field. */
  readonly message = signal('');
  /** The files a commit would contain now. */
  readonly paths = computed(() => {
    const committed = this.committed();
    const left = committed?.status === this.store.status() ? committed?.paths : undefined;
    const ticked = this.ticks.ticked().filter(path => !left?.has(path));
    const repositoryId = this.session.repository()?.id;
    if (repositoryId === undefined) {
      return ticked;
    }
    const known = new Set(ticked);
    const unlisted = this.openFiles.unsavedPaths(repositoryId)
      .filter(path => !known.has(path) && this.ticks.isTicked(path));
    return [ ...ticked, ...unlisted ];
  });
  /** Whether this repository's form waits for its commit. */
  readonly busy = computed(() => {
    const repositoryId = this.session.repository()?.id;
    return repositoryId !== undefined && this.running().has(repositoryId);
  });
  readonly error = computed(() => this.failure()?.shown ?? null);

  /** What a failure was about: when this changes, it may no longer be true. */
  private readonly formState = computed(() => {
    const repositoryId = this.session.repository()?.id;
    const paths = this.paths();
    const notSaved = repositoryId === undefined ? null : this.openFiles.notSaved(repositoryId, paths);
    return JSON.stringify([ this.message(), paths, notSaved?.error.code ?? null ]);
  });

  constructor() {
    let followed = untracked(this.store.followed);
    effect(() => {
      const repositoryId = this.store.followed();
      if (repositoryId !== followed) {
        followed = repositoryId;
        untracked(() => {
          this.message.set('');
          this.failure.set(null);
        });
      }
    });
    effect(() => {
      const failure = this.failure();
      if (failure !== null && failure.state !== this.formState()) {
        this.failure.set(null);
      }
    });
  }

  /**
   * Resolves `true` when the commit was made. Nothing happens, and it resolves
   * `false`, while another runs in this repository, or without a message or a file.
   */
  async commit(message: string): Promise<boolean> {
    const repositoryId = this.session.repository()?.id;
    const paths = this.paths();
    if (repositoryId === undefined || this.busy() || message.trim() === '' || paths.length === 0) {
      return false;
    }
    const stayed = () => this.session.repository()?.id === repositoryId;
    this.setRunning(repositoryId, true);
    this.failure.set(null);
    try {
      await this.openFiles.flushAll();
      const notSaved = this.openFiles.notSaved(repositoryId, paths);
      if (notSaved !== null) {
        if (stayed()) {
          this.fail(notSaved.error, notSaved.retry);
        }
        return false;
      }
      await firstValueFrom(this.api.commit(repositoryId, { message, paths: [ ...paths ] }));
      if (stayed()) {
        this.committed.set({ status: this.store.status(), paths: new Set(paths) });
        this.message.set('');
        await this.store.refresh();
      }
      return true;
    } catch (error) {
      if (stayed()) {
        this.fail(toApiError(error), !isRefusal(error));
      }
      return false;
    } finally {
      this.setRunning(repositoryId, false);
    }
  }

  private setRunning(repositoryId: number, running: boolean): void {
    const repositories = new Set(this.running());
    if (running) {
      repositories.add(repositoryId);
    } else {
      repositories.delete(repositoryId);
    }
    this.running.set(repositories);
  }

  private fail(error: ApiError, retry: boolean): void {
    this.failure.set({ shown: { ...this.errorText.describe(error), retry }, state: this.formState() });
  }
}
