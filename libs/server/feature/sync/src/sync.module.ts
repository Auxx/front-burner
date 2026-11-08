import { CredentialsModule } from '@front-burner/server-feature-credentials';
import { FilesModule } from '@front-burner/server-feature-files';
import { PreferencesModule } from '@front-burner/server-feature-preferences';
import { RepositoriesModule } from '@front-burner/server-feature-repositories';
import { Module } from '@nestjs/common';
import { GitController } from './git/git.controller';
import { GitJobs } from './jobs/git-jobs.service';
import { JobCredentials } from './jobs/job-credentials.service';
import { PushJob } from './push/push.job';
import { PushService } from './push/push.service';

/**
 * Git in a user's working copies (REQ-GIT-002). Needs the global auth guard, and
 * `GitModule`, `JobsModule` and `EventsModule`, which are global.
 */
@Module({
  imports: [ FilesModule, PreferencesModule, RepositoriesModule, CredentialsModule ],
  controllers: [ GitController ],
  providers: [ GitJobs, JobCredentials, PushService, PushJob ]
})
export class SyncModule {}
