import { FilesModule } from '@front-burner/server-feature-files';
import { Module } from '@nestjs/common';
import { GitController } from './git/git.controller';

/**
 * Git in a user's working copies (REQ-GIT-002). Needs the global auth guard and
 * `GitModule`, which is global.
 */
@Module({
  imports: [ FilesModule ],
  controllers: [ GitController ]
})
export class SyncModule {}
