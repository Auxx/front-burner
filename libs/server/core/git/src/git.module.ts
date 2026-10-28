import { DynamicModule, Module } from '@nestjs/common';
import { GitEngine } from './engine/git-engine';
import { GIT_OPTIONS, GitOptions } from './git.options';
import { WorkingTreeLock } from './lock/working-tree-lock';
import { GitRunner } from './runner/git-runner';

/** Provides the git engine and the working-tree lock everywhere. */
@Module({})
export class GitModule {
  static forRoot(options: GitOptions): DynamicModule {
    return {
      module: GitModule,
      global: true,
      providers: [ { provide: GIT_OPTIONS, useValue: options }, GitRunner, GitEngine, WorkingTreeLock ],
      exports: [ GIT_OPTIONS, GitEngine, WorkingTreeLock ]
    };
  }
}
