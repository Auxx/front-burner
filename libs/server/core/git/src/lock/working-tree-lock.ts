import { Injectable } from '@nestjs/common';
import { RepositoryQueue } from './repository-queue';

/**
 * Serialises everything that reads or changes a working tree or index, per repository (A-5.3).
 * Network steps do not take it; they take the NetworkLock.
 */
@Injectable()
export class WorkingTreeLock extends RepositoryQueue {
  /** Repositories removed since the start; IDs are never used again (AUTOINCREMENT). */
  private readonly removed = new Set<number>();

  /**
   * Marks the repository as removed, from inside its lock, so that the work
   * queued behind the removal can refuse to run on a working copy that is gone (RM-19).
   */
  markRemoved(repositoryId: number): void {
    this.removed.add(repositoryId);
  }

  /** Whether the repository was removed; asked inside the lock, before touching its working copy. */
  isRemoved(repositoryId: number): boolean {
    return this.removed.has(repositoryId);
  }

  /** How many times each repository's working copy was replaced since the start. */
  private readonly replaced = new Map<number, number>();

  /**
   * Marks, from inside its lock, that the repository's working copy was moved
   * away to be cloned again (RM-12), so that the work queued behind it, for the
   * old working copy, can refuse to run on the new one.
   */
  markReplaced(repositoryId: number): void {
    this.replaced.set(repositoryId, this.generation(repositoryId) + 1);
  }

  /**
   * Which working copy the repository has: read before queueing work, and
   * compared inside the lock. A change means it was replaced meanwhile.
   */
  generation(repositoryId: number): number {
    return this.replaced.get(repositoryId) ?? 0;
  }
}
