import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import type { ApiError, GitStatus } from '@front-burner/shared-contracts';
import { GitApi } from '@front-burner/web-api-client';
import { type ApiErrorText, ApiErrorTextService, isRefusal, toApiError } from '@front-burner/web-core';
import { firstValueFrom } from 'rxjs';

import { CommitAuthorGate } from '../commit-author-gate/commit-author-gate.service';
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
 * It first asks `CommitAuthorGate` (CA-12); cancelling there cancels the commit,
 * with the message kept. If the API still refuses a user who has not confirmed
 * (CA-13), the refusal is shown and the gate reads again, so that the next press
 * asks.
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
 *
 * **Amend last commit** (GA-22) is on offer while the status says the last commit
 * can be amended. Ticking it fills in that commit's message, and unticking it,
 * by hand or because the option went away, puts back what the field held, unless
 * the user changed the text, so that the old message is not committed by accident.
 * It is unticked, too, when the last commit is replaced while it is ticked.
 */
@Injectable()
export class CommitService {
  private readonly api = inject(GitApi);
  private readonly gate = inject(CommitAuthorGate);
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
  /** Which commit ticking Amend took the message from, what it put in the field, and what it replaced. */
  private amendFill: { oid: string; filled: string; replaced: string; } | null = null;

  /** The text of the message field. */
  readonly message = signal('');
  /** Whether **Amend last commit** is ticked. */
  readonly amending = signal(false);
  /** Whether **Amend last commit** is on offer (GA-22). */
  readonly canAmend = computed(() => this.store.status()?.lastCommit?.amendable === true);
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
    return JSON.stringify([ this.message(), this.amending(), paths, notSaved?.error.code ?? null ]);
  });

  constructor() {
    let followed = untracked(this.store.followed);
    effect(() => {
      const repositoryId = this.store.followed();
      if (repositoryId !== followed) {
        followed = repositoryId;
        untracked(() => {
          this.message.set('');
          this.amendFill = null;
          this.amending.set(false);
          this.failure.set(null);
        });
      }
    });
    let amended = false;
    effect(() => {
      const amending = this.amending();
      const oid = this.store.status()?.lastCommit?.oid;
      // A last commit replaced meanwhile, for example on another device, must not get the old message.
      if (amending && (!this.canAmend() || (this.amendFill !== null && this.amendFill.oid !== oid))) {
        this.amending.set(false);
      } else if (amending !== amended) {
        amended = amending;
        untracked(() => (amending ? this.fillIn() : this.undoFillIn()));
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
   * `false`, while another runs in this repository, or without a message, or
   * without a file unless amending.
   */
  async commit(message: string): Promise<boolean> {
    const repositoryId = this.session.repository()?.id;
    const paths = this.paths();
    const amend = this.amending();
    if (repositoryId === undefined || this.busy() || message.trim() === '' || (paths.length === 0 && !amend)) {
      return false;
    }
    const stayed = () => this.session.repository()?.id === repositoryId;
    this.setRunning(repositoryId, true);
    this.failure.set(null);
    try {
      if (!await this.gate.ready() || !stayed()) {
        return false;
      }
      const notSaved = await this.openFiles.flushed(repositoryId, paths);
      if (notSaved !== null) {
        if (stayed()) {
          this.fail(notSaved.error, notSaved.retry);
        }
        return false;
      }
      await firstValueFrom(
        this.api.commit(repositoryId, { message, paths: [ ...paths ], ...(amend ? { amend } : {}) })
      );
      if (stayed()) {
        this.committed.set({ status: this.store.status(), paths: new Set(paths) });
        this.message.set('');
        this.amendFill = null;
        this.amending.set(false);
        await this.store.refresh();
      }
      return true;
    } catch (error) {
      if (stayed()) {
        const apiError = toApiError(error);
        if (apiError.code === 'commit-author-not-confirmed') {
          this.gate.refresh();
        }
        if (apiError.code === 'amend-not-allowed') {
          // Before `fail`: the failure stays when the form has already changed.
          this.undoFillIn();
          this.amending.set(false);
          void this.store.refresh();
        }
        this.fail(apiError, !isRefusal(error));
      }
      return false;
    } finally {
      this.setRunning(repositoryId, false);
    }
  }

  private fillIn(): void {
    const lastCommit = this.store.status()?.lastCommit;
    const filled = lastCommit?.message ?? '';
    this.amendFill = { oid: lastCommit?.oid ?? '', filled, replaced: this.message() };
    this.message.set(filled);
  }

  private undoFillIn(): void {
    if (this.amendFill?.filled === this.message()) {
      this.message.set(this.amendFill.replaced);
    }
    this.amendFill = null;
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
