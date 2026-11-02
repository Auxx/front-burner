import { RepositoriesModule } from '@front-burner/server-feature-repositories';
import { Module } from '@nestjs/common';
import { CommitAuthorController } from './commit-author/commit-author.controller';
import { CommitAuthors } from './commit-author/commit-authors';

@Module({
  imports: [ RepositoriesModule ],
  controllers: [ CommitAuthorController ],
  providers: [ CommitAuthors ],
  exports: [ CommitAuthors ]
})
export class PreferencesModule {}
