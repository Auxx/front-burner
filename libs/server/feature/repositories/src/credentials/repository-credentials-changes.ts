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
  readonly #changed = new Subject<RepositoryCredentialsChange>();
  readonly #generations = new Map<number, number>();

  /** The repositories whose credentials changed, from now on, with their owner, who is told of what follows. */
  readonly changed: Observable<RepositoryCredentialsChange> = this.#changed.asObservable();

  /**
   * How many times the repository's credentials changed since the start. An
   * operation that reads it before it reads the credentials, and again when it
   * ends, can tell that its outcome is about credentials no longer in use
   * (RC-19). Kept in memory only, as no operation outlives a restart.
   */
  generation(repositoryId: number): number {
    return this.#generations.get(repositoryId) ?? 0;
  }

  /** The user's repositories whose credentials changed. */
  notifyChanged(userId: number, repositoryIds: readonly number[]): void {
    for (const repositoryId of repositoryIds) {
      this.#generations.set(repositoryId, this.generation(repositoryId) + 1);
      this.#changed.next({ userId, repositoryId });
    }
  }
}

/** One repository whose credentials changed, and its owner. */
export interface RepositoryCredentialsChange {
  userId: number;
  repositoryId: number;
}
