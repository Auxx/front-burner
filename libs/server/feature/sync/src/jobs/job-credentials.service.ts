import type { Repository } from '@front-burner/server-core-database';
import type { GitCredentials } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { JobKeys, SavedCredentialsService } from '@front-burner/server-feature-credentials';
import type { GitJobFailed } from '@front-burner/shared-contracts';
import { Injectable, NotFoundException } from '@nestjs/common';

const stringParams = (params: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(params).map(([ key, value ]) => [ key, String(value) ]));

/**
 * The credentials a network job reads when it runs: a protected key only from
 * the copy held since the job was queued (RC-19).
 */
@Injectable()
export class JobCredentials {
  constructor(private readonly saved: SavedCredentialsService, private readonly jobKeys: JobKeys) {}

  /**
   * The repository's credentials for the job, or the failure the job finishes
   * with when they cannot be used.
   */
  resolve(
    jobId: number,
    userId: number,
    row: Repository
  ): { credentials: GitCredentials; } | { failure: GitJobFailed; } {
    if (row.credentialId === null) {
      return { credentials: { kind: 'none' } };
    }
    try {
      return {
        credentials: this.saved.resolveForJob(userId, row.credentialId, this.jobKeys.take(jobId, row.credentialId))
      };
    } catch (error) {
      if (error instanceof ApiErrorException && error.getStatus() === 409) {
        // `key-locked` or `credentials-missing`, with what the user needs to fix it (RC-4).
        return { failure: { kind: 'failed', code: error.code, params: stringParams(error.params) } };
      }
      if (error instanceof NotFoundException) {
        // The credential is not the user's any more; a deleted one leaves the repository without any.
        return { failure: { kind: 'failed', code: 'credentials-missing', params: {} } };
      }
      throw error;
    }
  }
}
