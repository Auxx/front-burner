import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { RepositoryCommitAuthor } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { PreferencesApi } from '@front-burner/web-api-client';
import { PushChannelService } from '@front-burner/web-core';
import {
  ChangeCommitAuthorDialog,
  type CommitAuthorConfirmed,
  type CommitAuthorDialogData,
  ConfirmCommitAuthorDialog
} from '@front-burner/web-repository-dialogs';
import { firstValueFrom } from 'rxjs';

import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';

/**
 * The open repository's commit author (CA-6, CA-9), and the question before the
 * user's first commit (CA-12). Provided by the page.
 *
 * It reads the author when the repository is ready, on `commit-author.changed`,
 * and after every (re)connect, since events are never replayed (A-3.11). A read
 * that fails keeps what is shown, and `readFailed` says when that is nothing, so
 * that the form can warn instead of hiding who commits (CA-9).
 *
 * What it knows may be old, as the confirmation applies to the user and can be
 * given in another tab, so it reads again before it asks. The backend has the last
 * word (CA-13): when it refuses a commit, `CommitService` calls `refresh`, and the
 * next press asks.
 */
@Injectable()
export class CommitAuthorGate {
  private readonly api = inject(PreferencesApi);
  private readonly dialogs = inject(DialogService);
  private readonly push = inject(PushChannelService);
  private readonly session = inject(RepositorySessionService);
  private readonly store = inject(GitStatusStore);

  private readonly current = signal<RepositoryCommitAuthor | null>(null);
  private readonly lastReadFailed = signal(false);
  /** The latest read: only that one may change what is shown. */
  private latestRead = 0;

  /** The author that the next commit would use; `null` until it has been read. */
  readonly author = this.current.asReadonly();
  /** Whether no author can be shown, because the latest read failed. */
  readonly readFailed = computed(() => this.lastReadFailed() && this.current() === null);

  private readonly repositoryId = computed(() => {
    const id = this.store.followed();
    return this.session.state() === 'ready' && this.session.repository()?.id === id ? id : null;
  });

  constructor() {
    effect(() => {
      const id = this.repositoryId();
      untracked(() => {
        this.latestRead++;
        this.current.set(null);
        this.lastReadFailed.set(false);
        if (id !== null) {
          this.refresh();
        }
      });
    });
    // `reconnected` first, as in `TreeSyncService`.
    this.push.reconnected.pipe(takeUntilDestroyed()).subscribe(() => this.refresh());
    this.push.events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event.type === 'commit-author.changed') {
        this.refresh();
      }
    });
  }

  /**
   * Whether the commit may go on, asking first if the user has not confirmed.
   * Rejects when the author can't be read, as nothing could be shown. While no
   * repository can be read, it leaves the answer to the API, so that a failure is
   * shown rather than nothing happening.
   */
  async ready(): Promise<boolean> {
    const repositoryId = this.repositoryId();
    if (this.current()?.confirmed === true || repositoryId === null) {
      return true;
    }
    const current = await this.read(repositoryId);
    if (current.confirmed) {
      return true;
    }
    const answer = await firstValueFrom(
      this.dialogs.open<ConfirmCommitAuthorDialog, CommitAuthorDialogData, CommitAuthorConfirmed>(
        ConfirmCommitAuthorDialog,
        { data: { repositoryId, current } }
      ).closed
    );
    const confirmed = answer === 'confirmed';
    if (confirmed && this.repositoryId() === repositoryId) {
      this.current.update(author => author && { ...author, confirmed });
    }
    // Also after cancelling: part of a failed save may have reached the backend.
    await this.settle(repositoryId);
    return confirmed;
  }

  /** **Change** on the commit form (CA-9). */
  async change(): Promise<void> {
    const repositoryId = this.repositoryId();
    const current = this.current();
    if (repositoryId === null || current === null) {
      return;
    }
    const saved = await firstValueFrom(
      this.dialogs.open<ChangeCommitAuthorDialog, CommitAuthorDialogData, RepositoryCommitAuthor>(
        ChangeCommitAuthorDialog,
        { data: { repositoryId, current } }
      ).closed
    );
    if (saved !== undefined && this.repositoryId() === repositoryId) {
      this.current.set(saved);
    }
    // Also after cancelling: part of a failed save may have reached the backend.
    await this.settle(repositoryId);
  }

  /** Reads the author again, such as for **Try again**. */
  refresh(): void {
    const repositoryId = this.repositoryId();
    if (repositoryId !== null) {
      void this.settle(repositoryId);
    }
  }

  /** Reads, for what is shown only: a failed read changes nothing. */
  private async settle(repositoryId: number): Promise<void> {
    try {
      await this.read(repositoryId);
    } catch {
      // Keeps what is shown; the next event or commit reads again.
    }
  }

  private async read(repositoryId: number): Promise<RepositoryCommitAuthor> {
    const read = ++this.latestRead;
    const isLatest = () => read === this.latestRead && this.repositoryId() === repositoryId;
    try {
      const author = await firstValueFrom(this.api.repositoryCommitAuthor(repositoryId));
      if (isLatest()) {
        this.current.set(author);
        this.lastReadFailed.set(false);
      }
      return author;
    } catch (error) {
      if (isLatest()) {
        this.lastReadFailed.set(true);
      }
      throw error;
    }
  }
}
