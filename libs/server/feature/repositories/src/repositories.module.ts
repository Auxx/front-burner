import { CredentialsModule } from '@front-burner/server-feature-credentials';
import { Module } from '@nestjs/common';
import { RequestCredentials } from './add/request-credentials';
import { RepositoriesController } from './repositories/repositories.controller';
import { RepositoryQueries } from './repositories/repository-queries';

/** The user's repositories (REQ-DASH-001, REQ-REPO-001). Needs the global auth guard. */
@Module({
  imports: [ CredentialsModule ],
  controllers: [ RepositoriesController ],
  providers: [ RepositoryQueries, RequestCredentials ]
})
export class RepositoriesModule {}
