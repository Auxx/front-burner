import { ApiErrorException } from '@front-burner/server-core-observability';
import { DATA_LAYOUT, DataLayout } from '@front-burner/server-core-storage';
import { RepositoryQueries } from '@front-burner/server-feature-repositories';
import { Inject, Injectable } from '@nestjs/common';

/** Finds the repository behind every files endpoint (FB-2, FB-3). */
@Injectable()
export class OpenableRepository {
  constructor(
    private readonly queries: RepositoryQueries,
    @Inject(DATA_LAYOUT) private readonly layout: DataLayout
  ) {}

  /**
   * The working copy of one of the user's `ready` repositories. Another user's
   * is answered like a missing one (FB-2); one that is not ready is refused
   * with its status (FB-3).
   *
   * @throws ApiErrorException
   */
  root(userId: number, id: number): string {
    const repository = this.queries.find(userId, id);
    if (repository === undefined) {
      throw new ApiErrorException(404, 'not-found');
    }
    if (repository.status !== 'ready') {
      throw new ApiErrorException(409, 'repository-not-openable', { status: repository.status });
    }
    return this.layout.workingCopy(userId, id);
  }
}
