import { RepositoriesModule } from '@front-burner/server-feature-repositories';
import { Module } from '@nestjs/common';
import { FilesController } from './files/files.controller';
import { FolderLister } from './listing/folder-lister';
import { OpenableRepository } from './repository/openable-repository';

/**
 * The files of a user's working copies (REQ-FILE-001). Needs the global auth
 * guard, `GitModule` and `StorageModule`, which are global.
 */
@Module({
  imports: [ RepositoriesModule ],
  controllers: [ FilesController ],
  providers: [ OpenableRepository, FolderLister ],
  exports: [ OpenableRepository ]
})
export class FilesModule {}
