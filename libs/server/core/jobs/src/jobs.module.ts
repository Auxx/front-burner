import { Global, Module } from '@nestjs/common';
import { JobRunner } from './runner/job-runner';

/** The job runner (A-6). Global, so that any feature can register and enqueue jobs. */
@Global()
@Module({
  providers: [ JobRunner ],
  exports: [ JobRunner ]
})
export class JobsModule {}
