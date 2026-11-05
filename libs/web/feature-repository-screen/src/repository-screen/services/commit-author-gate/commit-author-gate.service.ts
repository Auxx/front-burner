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
 * It reads the author when the repository is ready, on `git.changed`, which a
 * change of an override publishes, and after every (re)connect, since a change of
 * the default publishes nothing and events are never replayed (A-3.11). A read
 * that fails keeps what is shown.
 *
 * What it knows may be old, as the confirmation applies to the user and can be
 * given in another tab. So it reads again before it asks, and the API's refusal
 * (CA-13) leads here too: both end in the same place, and a user who has confirmed
 * is not asked again.
 */
@Injectable()
export class CommitAuthorGate {
  private readonly api = inject(PreferencesApi);
  private readonly dialogs = inject(DialogService);
  private readonly push = inject(PushChannelService);
  private readonly session = inject(RepositorySessionService);
  private readonly store = inject(GitStatusStore);

  private readonly current = signal<RepositoryCommitAuthor | null>(null);
  /** The latest read: only that one may change what is shown. */
  private latestRead = 0;

  /** The author that the next commit would use; `null` until it has been read. */
  readonly author = this.current.asReadonly();

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
        if (id !== null) {
          this.refresh();
        }
      });
    });
    // `reconnected` first, as in `TreeSyncService`.
    this.push.reconnected.pipe(takeUntilDestroyed()).subscribe(() => this.refresh());
    this.push.events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event.type === 'git.changed' && event.repositoryId === this.repositoryId()) {
        this.refresh();
      }
    });
  }

  /**
   * Whether the commit may go on, asking first if the user has not confirmed.
   * Rejects when the author can't be read, as nothing could be shown.
   */
  async ready(): Promise<boolean> {
    return this.current()?.confirmed === true || this.recheck();
  }

  /** As `ready`, without trusting what is known, for when the API refused a commit (CA-13). */
  async recheck(): Promise<boolean> {
    const repositoryId = this.repositoryId();
    if (repositoryId === null) {
      return false;
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
    // Also after cancelling: **Change** may have saved an override before confirming failed.
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
    if (saved !== undefined) {
      if (this.repositoryId() === repositoryId) {
        this.current.set(saved);
      }
      await this.settle(repositoryId);
    }
  }

  private refresh(): void {
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
    const author = await firstValueFrom(this.api.repositoryCommitAuthor(repositoryId));
    if (read === this.latestRead && this.repositoryId() === repositoryId) {
      this.current.set(author);
    }
    return author;
  }
}
