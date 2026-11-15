import { CredentialsModule } from '@front-burner/server-feature-credentials';
import { Module } from '@nestjs/common';
import { AddRepositoryService } from './add/add-repository.service';
import { CredentialsCheck } from './add/credentials-check';
import { RequestCredentials } from './add/request-credentials';
import { CloneJob } from './clone/clone.job';
import { RepositoryCredentialsChanges } from './credentials/repository-credentials-changes';
import { RepositoryCredentialsController } from './credentials/repository-credentials.controller';
import { RepositoryCredentialsService } from './credentials/repository-credentials.service';
import { WorkingCopyDamage } from './damage/working-copy-damage';
import { WorkingCopyDamageInterceptor } from './damage/working-copy-damage.interceptor';
import { WorkingCopyCheck } from './recovery/working-copy-check';
import { RemovalCheck } from './remove/removal-check';
import { InstanceRepositories } from './repositories/instance-repositories';
import { RepositoriesController } from './repositories/repositories.controller';
import { RepositoryQueries } from './repositories/repository-queries';
import { RemoteProblemsSource } from './warnings/remote-problems-source';
import { RepositoryWarnings } from './warnings/repository-warnings';

/** The user's repositories and the credentials they use (REQ-DASH-001, REQ-REPO-001, REQ-REPO-002). Needs the global auth guard. */
@Module({
  imports: [ CredentialsModule ],
  controllers: [ RepositoriesController, RepositoryCredentialsController ],
  providers: [
    RepositoryQueries,
    InstanceRepositories,
    RepositoryCredentialsService,
    RepositoryCredentialsChanges,
    RequestCredentials,
    CredentialsCheck,
    AddRepositoryService,
    CloneJob,
    WorkingCopyCheck,
    RemoteProblemsSource,
    RepositoryWarnings,
    WorkingCopyDamage,
    WorkingCopyDamageInterceptor,
    RemovalCheck
  ],
  exports: [
    RepositoryQueries,
    InstanceRepositories,
    RepositoryCredentialsChanges,
    RemoteProblemsSource,
    WorkingCopyDamage,
    WorkingCopyDamageInterceptor
  ]
})
export class RepositoriesModule {}
