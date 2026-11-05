import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import type { ApiError } from '@front-burner/shared-contracts';
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
 * The files are those the button named when it was pressed. The waiting saves
 * are sent first (GA-20), and a ticked file whose newest edits did not reach the
 * disk stops the commit, since it must contain what the user sees. The status is
 * read before the form is free again, so that it can't commit an old list.
 */
@Injectable()
export class CommitService {
  private readonly api = inject(GitApi);
  private readonly store = inject(GitStatusStore);
  private readonly ticks = inject(CommitTicksService);
  private readonly openFiles = inject(OpenFilesService);
  private readonly session = inject(RepositorySessionService);
  private readonly errorText = inject(ApiErrorTextService);

  private readonly running = signal(false);
  private readonly failure = signal<CommitFailure | null>(null);

  /** The text of the message field. */
  readonly message = signal('');
  readonly busy = this.running.asReadonly();
  readonly error = this.failure.asReadonly();

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
  }

  /**
   * Resolves `true` when the commit was made. Nothing happens, and it resolves
   * `false`, while another runs, or without a message or a ticked file.
   */
  async commit(message: string): Promise<boolean> {
    const repositoryId = this.session.repository()?.id;
    const paths = this.ticks.ticked();
    if (repositoryId === undefined || this.running() || message.trim() === '' || paths.length === 0) {
      return false;
    }
    const stayed = () => this.session.repository()?.id === repositoryId;
    this.running.set(true);
    this.failure.set(null);
    try {
      await this.openFiles.flushAll();
      const notSaved = stayed() ? this.openFiles.notSaved(paths) : null;
      if (notSaved !== null) {
        this.fail(notSaved.error, notSaved.retry);
        return false;
      }
      await firstValueFrom(this.api.commit(repositoryId, { message, paths }));
      if (stayed()) {
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
      this.running.set(false);
    }
  }

  private fail(error: ApiError, retry: boolean): void {
    this.failure.set({ ...this.errorText.describe(error), retry });
  }
}
