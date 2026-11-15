import { EventsHub } from '@front-burner/server-core-events';
import { GitOperationError } from '@front-burner/server-core-git';
import type { GitJobFailed } from '@front-burner/shared-contracts';
import { Injectable, Logger } from '@nestjs/common';
import { InstanceRepositories } from '../repositories/instance-repositories';

/** Whether git found the working copy gone or unusable (RM-6). */
export const isWorkingCopyMissing = (error: unknown): error is GitOperationError =>
  error instanceof GitOperationError && error.code === 'working-copy-missing';

/** How a git job ends when it finds the working copy missing or damaged. */
export const WORKING_COPY_MISSING_OUTCOME: GitJobFailed = { kind: 'failed', code: 'working-copy-missing', params: {} };

/**
 * A working copy that git found missing or damaged while the backend runs gets
 * the status Error, "Working copy is missing or damaged", as on start (RM-6),
 * with git's message for **Details** (RM-10). Requests report it through
 * `WorkingCopyDamageInterceptor`, and jobs through `inJob`.
 */
@Injectable()
export class WorkingCopyDamage {
  private readonly logger = new Logger(WorkingCopyDamage.name);

  constructor(
    private readonly instance: InstanceRepositories,
    private readonly events: EventsHub
  ) {}

  /**
   * Marks the user's ready repository damaged and publishes `repository.status`.
   * Requests that find it together change it, and publish, once.
   */
  report(userId: number, repositoryId: number, detail: string): void {
    if (!this.instance.markReadyDamaged(userId, repositoryId, detail)) {
      return;
    }
    this.logger.warn(`The working copy of repository ${repositoryId} is missing or damaged: ${detail.trim()}`);
    this.events.publish(userId, {
      type: 'repository.status',
      repositoryId,
      status: 'error',
      error: 'working-copy-missing'
    });
  }

  /** A git job's work: when it finds the working copy missing or damaged, that is reported and the job ends as failed. */
  async inJob<T>(userId: number, repositoryId: number, work: () => Promise<T>): Promise<T | GitJobFailed> {
    try {
      return await work();
    } catch (error) {
      if (!isWorkingCopyMissing(error)) {
        throw error;
      }
      this.report(userId, repositoryId, error.detail);
      return WORKING_COPY_MISSING_OUTCOME;
    }
  }
}
