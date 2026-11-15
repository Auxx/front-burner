import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/**
 * Tells other features which repositories now use other credentials, or new
 * secrets of the same saved credentials, so that the sync feature can forget
 * "Can't push with these credentials" (RM-8) without this feature depending
 * on it, as `SessionLifecycle` does for sessions _(plan 107's call)_.
 */
@Injectable()
export class RepositoryCredentialsChanges {
  readonly #changed = new Subject<number>();

  /** The IDs of repositories whose credentials changed, from now on. */
  readonly changed: Observable<number> = this.#changed.asObservable();

  notifyChanged(repositoryIds: readonly number[]): void {
    for (const id of repositoryIds) {
      this.#changed.next(id);
    }
  }
}
