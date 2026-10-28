import { RepositoriesModule } from '@front-burner/server-feature-repositories';
import { Module } from '@nestjs/common';
import { EntryActions } from './actions/entry-actions';
import { WorkingTreeGuard } from './actions/working-tree-guard';
import { FilesController } from './files/files.controller';
import { FolderLister } from './listing/folder-lister';
import { OpenableRepository } from './repository/openable-repository';
import { EntrySummaries } from './summary/entry-summaries';

/**
 * The files of a user's working copies (REQ-FILE-001). Needs the global auth
 * guard, `GitModule`, `StorageModule` and `EventsModule`, which are global.
 */
@Module({
  imports: [ RepositoriesModule ],
  controllers: [ FilesController ],
  providers: [ OpenableRepository, FolderLister, WorkingTreeGuard, EntryActions, EntrySummaries ],
  exports: [ OpenableRepository, WorkingTreeGuard ]
})
export class FilesModule {}
