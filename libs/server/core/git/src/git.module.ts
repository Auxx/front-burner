import { DynamicModule, Module } from '@nestjs/common';
import { GitEngine } from './engine/git-engine';
import { GIT_OPTIONS, GitOptions } from './git.options';
import { GitRunner } from './runner/git-runner';

/** Provides the git engine everywhere. */
@Module({})
export class GitModule {
  static forRoot(options: GitOptions): DynamicModule {
    return {
      module: GitModule,
      global: true,
      providers: [ { provide: GIT_OPTIONS, useValue: options }, GitRunner, GitEngine ],
      exports: [ GIT_OPTIONS, GitEngine ]
    };
  }
}
