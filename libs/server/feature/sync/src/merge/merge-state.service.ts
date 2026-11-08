import { ConflictEntry, GitEngine, GitMerge, REGULAR_FILE } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { inBatches, PathRefusedError } from '@front-burner/server-core-storage';
import { FileContents } from '@front-burner/server-feature-files';
import type { GitConflictFile, GitMergeState } from '@front-burner/shared-contracts';
import { isMarkdownName } from '@front-burner/shared-util';
import { Injectable } from '@nestjs/common';

/**
 * The merge in progress, read from git each time, so that any device can carry
 * on and a restart changes nothing (A-4.5, GC-4). Takes no lock (A-5.3).
 */
@Injectable()
export class MergeStateService {
  constructor(
    private readonly engine: GitEngine,
    private readonly merge: GitMerge,
    private readonly contents: FileContents
  ) {}

  /**
   * @throws ApiErrorException `no-merge-in-progress`
   */
  async read(root: string): Promise<GitMergeState> {
    if (!await this.engine.mergeInProgress(root)) {
      throw new ApiErrorException(409, 'no-merge-in-progress');
    }
    const [ status, conflicts, message ] = await Promise.all([
      this.engine.status(root),
      this.merge.conflicts(root),
      this.merge.mergeMessage(root)
    ]);
    const files = new Map<string, GitConflictFile>();
    await inBatches(conflicts, async entry => {
      files.set(entry.path, await this.toFile(root, entry));
    });
    return {
      // A merge that git started without a pull, on no branch or without an upstream,
      // must still be readable, so that the user can get out of it. These are git's names.
      into: status.branch ?? 'HEAD',
      from: status.upstream ?? 'MERGE_HEAD',
      files: conflicts.flatMap(({ path }) => files.get(path) ?? []),
      otherFiles: await this.merge.mergedWithoutConflicts(root, new Set(conflicts.map(({ path }) => path))),
      message
    };
  }

  private async toFile(root: string, entry: ConflictEntry): Promise<GitConflictFile> {
    const { path, kind, resolved, mineSize, theirsSize } = entry;
    return { path, kind, resolved, mineSize, theirsSize, editable: await this.isEditable(root, entry) };
  }

  /** GC-9: what git has can hold markers, and the editor would open what is on disk (ED-2). */
  private async isEditable(root: string, { path, mineMode, theirsMode }: ConflictEntry): Promise<boolean> {
    const regular = REGULAR_FILE.test(mineMode ?? '') && REGULAR_FILE.test(theirsMode ?? '');
    if (!regular || !isMarkdownName(path.split('/').at(-1) ?? '')) {
      return false;
    }
    try {
      // Both versions exist, so this is Both changed or Both added.
      await this.contents.read(root, path);
      return true;
    } catch (error) {
      if (error instanceof PathRefusedError || error instanceof ApiErrorException) {
        return false;
      }
      throw error;
    }
  }
}
