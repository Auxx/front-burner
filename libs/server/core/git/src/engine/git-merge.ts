import { Injectable } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalGit } from './local-git';

/** Where the commit before a merge is kept, so that git's garbage collection keeps it (A-5.12). */
export const PRE_MERGE_REF = 'refs/front-burner/pre-merge';

/**
 * Local merge operations of a working copy. Takes no locks: the caller holds
 * the working-tree lock.
 */
@Injectable()
export class GitMerge {
  constructor(private readonly local: LocalGit) {}

  /** Keeps the current commit under `PRE_MERGE_REF`; gives it. */
  async record(workingCopy: string): Promise<string> {
    const oid = (
      await this.local.checked(workingCopy, [ 'rev-parse', '--verify', 'HEAD' ])
    ).trim();
    await this.keepRecord(workingCopy, oid);
    return oid;
  }

  /** Drops the ref; the commit is then up to garbage collection. */
  async forgetRecord(workingCopy: string): Promise<void> {
    await this.local.checked(workingCopy, [ 'update-ref', '-d', PRE_MERGE_REF ]);
  }

  /** Points the ref at an earlier record again. */
  async keepRecord(workingCopy: string, oid: string): Promise<void> {
    await this.local.checked(workingCopy, [ 'update-ref', PRE_MERGE_REF, oid ]);
  }

  /**
   * Puts every file back as it was at `oid`, which also ends a merge. The caller
   * knows the working copy was clean when the commit was recorded (GA-26).
   */
  async resetTo(workingCopy: string, oid: string): Promise<void> {
    await this.local.checked(workingCopy, [ 'reset', '-q', '--hard', oid ]);
  }

  /**
   * Undoes a merge that git did not finish. A killed git leaves `index.lock`,
   * which makes `reset` fail, and a checkout killed partway leaves untracked
   * files that `reset` keeps. `clean` without `-x` leaves ignored files, and the
   * working copy had nothing else untracked (GA-26).
   */
  async undoCutShort(workingCopy: string, oid: string): Promise<void> {
    await rm(join(workingCopy, '.git', 'index.lock'), { force: true });
    await this.resetTo(workingCopy, oid);
    await this.local.checked(workingCopy, [ 'clean', '-fdq' ]);
  }
}
