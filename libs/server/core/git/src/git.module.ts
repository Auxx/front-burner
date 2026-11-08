import { DynamicModule, Module } from '@nestjs/common';
import { GitEngine } from './engine/git-engine';
import { GitMerge } from './engine/git-merge';
import { LocalGit } from './engine/local-git';
import { GIT_OPTIONS, GitOptions } from './git.options';
import { NetworkLock } from './lock/network-lock';
import { WorkingTreeLock } from './lock/working-tree-lock';
import { GitRunner } from './runner/git-runner';

/** Provides the git engine, the working-tree lock and the network lock everywhere. */
@Module({})
export class GitModule {
  static forRoot(options: GitOptions): DynamicModule {
    return {
      module: GitModule,
      global: true,
      providers: [
        { provide: GIT_OPTIONS, useValue: options },
        GitRunner,
        LocalGit,
        GitEngine,
        GitMerge,
        WorkingTreeLock,
        NetworkLock
      ],
      exports: [
        GIT_OPTIONS,
        LocalGit,
        GitEngine,
        GitMerge,
        WorkingTreeLock,
        NetworkLock
      ]
    };
  }
}
