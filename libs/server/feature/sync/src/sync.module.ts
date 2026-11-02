import { FilesModule } from '@front-burner/server-feature-files';
import { PreferencesModule } from '@front-burner/server-feature-preferences';
import { Module } from '@nestjs/common';
import { GitController } from './git/git.controller';

/**
 * Git in a user's working copies (REQ-GIT-002). Needs the global auth guard, and
 * `GitModule` and `EventsModule`, which are global.
 */
@Module({
  imports: [ FilesModule, PreferencesModule ],
  controllers: [ GitController ]
})
export class SyncModule {}
