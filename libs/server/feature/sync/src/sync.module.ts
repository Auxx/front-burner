import { CredentialsModule } from '@front-burner/server-feature-credentials';
import { FilesModule } from '@front-burner/server-feature-files';
import { PreferencesModule } from '@front-burner/server-feature-preferences';
import { RepositoriesModule } from '@front-burner/server-feature-repositories';
import { Module } from '@nestjs/common';
import { FetchScheduler } from './fetch/fetch-scheduler';
import { FetchStep } from './fetch/fetch-step';
import { FetchJob } from './fetch/fetch.job';
import { FetchService } from './fetch/fetch.service';
import { GitController } from './git/git.controller';
import { GitJobs } from './jobs/git-jobs.service';
import { JobCredentials } from './jobs/job-credentials.service';
import { NetworkJobs } from './jobs/network-jobs.service';
import { PullJob } from './pull/pull.job';
import { PullService } from './pull/pull.service';
import { PushJob } from './push/push.job';
import { PushService } from './push/push.service';
import { SyncStateStore } from './state/sync-state.store';

/**
 * Git in a user's working copies (REQ-GIT-002). Needs the global auth guard, and
 * `GitModule`, `JobsModule` and `EventsModule`, which are global.
 */
@Module({
  imports: [ FilesModule, PreferencesModule, RepositoriesModule, CredentialsModule ],
  controllers: [ GitController ],
  providers: [
    GitJobs,
    JobCredentials,
    NetworkJobs,
    PushService,
    PushJob,
    FetchStep,
    FetchService,
    FetchJob,
    FetchScheduler,
    PullService,
    PullJob,
    SyncStateStore
  ]
})
export class SyncModule {}
