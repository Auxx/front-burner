import { CredentialsModule } from '@front-burner/server-feature-credentials';
import { Module } from '@nestjs/common';
import { AddRepositoryService } from './add/add-repository.service';
import { RequestCredentials } from './add/request-credentials';
import { CloneKeys } from './clone/clone-keys';
import { RepositoriesController } from './repositories/repositories.controller';
import { RepositoryQueries } from './repositories/repository-queries';

/** The user's repositories (REQ-DASH-001, REQ-REPO-001). Needs the global auth guard. */
@Module({
  imports: [ CredentialsModule ],
  controllers: [ RepositoriesController ],
  providers: [ RepositoryQueries, RequestCredentials, AddRepositoryService, CloneKeys ]
})
export class RepositoriesModule {}
