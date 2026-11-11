import { ConflictEntry, GitMerge, REGULAR_FILE } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { inBatches, PathRefusedError } from '@front-burner/server-core-storage';
import { decodeMarkdown, FileContents } from '@front-burner/server-feature-files';
import { EDITABLE_FILE_LIMIT } from '@front-burner/shared-contracts';
import type { GitConflictFile, GitMergeState, GitMergeVersion } from '@front-burner/shared-contracts';
import { hasConflictMarkers, isMarkdownName } from '@front-burner/shared-util';
import { Injectable, Logger } from '@nestjs/common';

/**
 * What GC-9 asks of the versions, which needs no read: both exist as regular
 * files, and the name is Markdown's. The file on disk must also pass `isEditableText`.
 */
export function mayBeEditable({ path, oursMode, theirsMode }: ConflictEntry): boolean {
  const regular = REGULAR_FILE.test(oursMode ?? '') && REGULAR_FILE.test(theirsMode ?? '');
  return regular && isMarkdownName(path.split('/').at(-1) ?? '');
}

/**
 * The merge in progress, read from git each time, so that any device can carry
 * on and a restart changes nothing (A-4.5, GC-4). Takes no lock (A-5.3).
 */
@Injectable()
export class MergeStateService {
  private readonly logger = new Logger(MergeStateService.name);

  constructor(
    private readonly merge: GitMerge,
    private readonly contents: FileContents
  ) {}

  /**
   * Read one version of a conflicting file for the user to compare (GC-17).
   * @throws ApiErrorException `no-merge-in-progress`, `not-conflicting`, `version-not-readable`
   */
  async readVersion(root: string, path: string, side: 'ours' | 'theirs'): Promise<GitMergeVersion> {
    if (!await this.merge.mergeInProgress(root)) {
      throw new ApiErrorException(409, 'no-merge-in-progress');
    }
    const entry = await this.merge.conflict(root, path);
    if (entry === null) {
      // If the merge was aborted between the first check and now, return the correct code.
      if (!await this.merge.mergeInProgress(root)) {
        throw new ApiErrorException(409, 'no-merge-in-progress');
      }
      throw new ApiErrorException(409, 'not-conflicting');
    }
    const sideValues = side === 'ours'
      ? { oid: entry.oursOid, mode: entry.oursMode, size: entry.oursSize }
      : { oid: entry.theirsOid, mode: entry.theirsMode, size: entry.theirsSize };
    // Check all readability conditions before reading the blob (ED-2).
    if (
      sideValues.oid === null
      || !isMarkdownName(entry.path.split('/').at(-1) ?? '')
      || !REGULAR_FILE.test(sideValues.mode ?? '')
      || (sideValues.size !== null && sideValues.size > EDITABLE_FILE_LIMIT)
    ) {
      throw new ApiErrorException(409, 'version-not-readable');
    }
    const decoded = decodeMarkdown(await this.merge.readVersion(root, sideValues.oid));
    if (decoded === 'not-utf8') {
      throw new ApiErrorException(409, 'version-not-readable');
    }
    return { content: decoded.content };
  }

  /**
   * @throws ApiErrorException `no-merge-in-progress`
   */
  async read(root: string): Promise<GitMergeState> {
    if (!await this.merge.mergeInProgress(root)) {
      throw new ApiErrorException(409, 'no-merge-in-progress');
    }
    const [ { branch, upstream }, conflicts, message ] = await Promise.all([
      this.merge.branchAndUpstream(root),
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
      into: branch ?? 'HEAD',
      from: upstream ?? 'MERGE_HEAD',
      files: conflicts.flatMap(({ path }) => files.get(path) ?? []),
      otherFiles: await this.merge.mergedWithoutConflicts(root, new Set(conflicts.map(({ path }) => path))),
      message
    };
  }

  private async toFile(root: string, entry: ConflictEntry): Promise<GitConflictFile> {
    const { path, kind, resolved, oursSize, theirsSize } = entry;
    return { path, kind, resolved, oursSize, theirsSize, editable: await this.isEditable(root, entry) };
  }

  /**
   * GC-9: both versions exist as regular files that git can merge as text, and
   * the editor would open what is on disk (ED-2). Never throws: one file that
   * can't be checked must not keep the user from the merge. It is simply not
   * offered for editing, and whole versions still resolve it (GC-15).
   */
  private async isEditable(root: string, entry: ConflictEntry): Promise<boolean> {
    if (!mayBeEditable(entry)) {
      return false;
    }
    try {
      return await this.isEditableText(root, entry, await this.contents.readTracked(root, entry.path));
    } catch (error) {
      if (!(error instanceof PathRefusedError || error instanceof ApiErrorException)) {
        this.logger.warn(`Could not check a conflicting file: ${String(error)}`);
      }
      return false;
    }
  }

  /**
   * The rest of GC-9 for a file that `mayBeEditable`, with its text already read:
   * git can merge the versions as text. Lines that look like markers say so
   * without asking git; a file without them may be one the user already edited.
   */
  async isEditableText(root: string, entry: ConflictEntry, text: string): Promise<boolean> {
    return hasConflictMarkers(text) || await this.merge.canWriteMarkers(root, entry);
  }
}
