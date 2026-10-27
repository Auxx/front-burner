import { Module } from '@nestjs/common';
import { RepositoriesController } from './repositories/repositories.controller';
import { RepositoryQueries } from './repositories/repository-queries';

/** The user's repositories (REQ-DASH-001, REQ-REPO-001). Needs the global auth guard. */
@Module({
  controllers: [ RepositoriesController ],
  providers: [ RepositoryQueries ]
})
export class RepositoriesModule {}
