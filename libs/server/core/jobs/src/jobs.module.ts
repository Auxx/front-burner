import { Global, Module } from '@nestjs/common';
import { FinishedJobsCleanup } from './housekeeping/finished-jobs-cleanup';
import { JobRunner } from './runner/job-runner';

/** The job runner (A-6). Global, so that any feature can register and enqueue jobs. */
@Global()
@Module({
  providers: [ JobRunner, FinishedJobsCleanup ],
  exports: [ JobRunner ]
})
export class JobsModule {}
