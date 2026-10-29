import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PushChannelService } from '@front-burner/web-core';
import { filter, Subscription } from 'rxjs';

import { EntryCommandsService } from '../entry-commands/entry-commands.service';
import { FileTreeStoreService } from '../file-tree-store/file-tree-store.service';

/**
 * Keeps the repository screen up to date with changes made elsewhere, from
 * the push channel (A-3.11, A-8.5). Provided by the page.
 *
 * - `files.changed` lists the shown folders it names again (FB-41).
 * - A (re)connect lists every shown folder again, since events are never
 *   replayed.
 *
 * When the open file, which was listed, is gone from the listings that come
 * back, and this tab is not the one that deleted or renamed it
 * (`EntryCommandsService.ownChange`), `goneElsewhere` names it (FB-42).
 */
@Injectable()
export class TreeSyncService {
  private readonly push = inject(PushChannelService);
  private readonly store = inject(FileTreeStoreService);
  private readonly commands = inject(EntryCommandsService);
  private readonly route = inject(ActivatedRoute);

  private readonly gone = signal<string | null>(null);
  /** The path of the open file once it was deleted or renamed elsewhere (FB-42). */
  readonly goneElsewhere = this.gone.asReadonly();

  private subscription: Subscription | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.subscription?.unsubscribe());
  }

  /** Follows the events of the repository `repositoryId` until the page is destroyed. */
  start(repositoryId: number): void {
    this.subscription?.unsubscribe();
    const subscription = new Subscription();
    // `reconnected` first, so that the first connect, which the events start, is seen.
    subscription.add(this.push.reconnected.subscribe(() => void this.sync('all')));
    subscription.add(
      this.push.events
        .pipe(filter(event => 'repositoryId' in event && event.repositoryId === repositoryId))
        .subscribe(event => {
          if (event.type === 'files.changed') {
            void this.sync(event.folders);
          }
        })
    );
    this.subscription = subscription;
  }

  /** Forgets the file gone elsewhere, as when another path is shown. */
  clear(): void {
    this.gone.set(null);
  }

  /** Lists `folders` again, then checks whether the open file is still there. */
  private async sync(folders: readonly string[] | 'all'): Promise<void> {
    const path = this.route.snapshot.paramMap.get('path') ?? '';
    const listed = path !== '' && this.store.entry(path) !== undefined;
    await this.store.reload(folders);
    if (
      listed && path === (this.route.snapshot.paramMap.get('path') ?? '') && !this.commands.isOwnChange(path)
      && this.store.gone(path)
    ) {
      this.gone.set(path);
    }
  }
}
