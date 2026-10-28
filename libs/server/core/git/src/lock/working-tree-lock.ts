import { Injectable } from '@nestjs/common';

/**
 * Serialises everything that reads or changes a working tree or index, per repository (A-5.3).
 * In memory, because there is one process (NF-4.2). Network steps do not take it.
 */
@Injectable()
export class WorkingTreeLock {
  /** The last queued task of each busy repository; never rejects. */
  private readonly tails = new Map<number, Promise<unknown>>();

  /** Repositories with queued or running tasks. */
  get size(): number {
    return this.tails.size;
  }

  /**
   * Runs `task` after the tasks already queued for the repository, in the order they arrived.
   * A task that fails releases the lock; its error reaches only its own caller.
   */
  run<T>(repositoryId: number, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(repositoryId) ?? Promise.resolve();
    const result = previous.then(() => task()).finally(() => {
      if (this.tails.get(repositoryId) === tail) {
        this.tails.delete(repositoryId);
      }
    });
    const tail: Promise<unknown> = result.catch(() => undefined);
    this.tails.set(repositoryId, tail);
    return result;
  }
}
