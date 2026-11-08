import { CredentialsModule } from '@front-burner/server-feature-credentials';
import { Module } from '@nestjs/common';
import { AddRepositoryService } from './add/add-repository.service';
import { CredentialsCheck } from './add/credentials-check';
import { RequestCredentials } from './add/request-credentials';
import { CloneJob } from './clone/clone.job';
import { RepositoryCredentialsController } from './credentials/repository-credentials.controller';
import { RepositoryCredentialsService } from './credentials/repository-credentials.service';
import { WorkingCopyCheck } from './recovery/working-copy-check';
import { InstanceRepositories } from './repositories/instance-repositories';
import { RepositoriesController } from './repositories/repositories.controller';
import { RepositoryQueries } from './repositories/repository-queries';

/** The user's repositories and the credentials they use (REQ-DASH-001, REQ-REPO-001, REQ-REPO-002). Needs the global auth guard. */
@Module({
  imports: [ CredentialsModule ],
  controllers: [ RepositoriesController, RepositoryCredentialsController ],
  providers: [
    RepositoryQueries,
    InstanceRepositories,
    RepositoryCredentialsService,
    RequestCredentials,
    CredentialsCheck,
    AddRepositoryService,
    CloneJob,
    WorkingCopyCheck
  ],
  exports: [ RepositoryQueries, InstanceRepositories ]
})
export class RepositoriesModule {}
