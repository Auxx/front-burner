import { ConflictEntry, GitMerge, REGULAR_FILE } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { inBatches, PathRefusedError } from '@front-burner/server-core-storage';
import { FileContents } from '@front-burner/server-feature-files';
import {
  EDITABLE_FILE_LIMIT,
  type GitConflictFile,
  type GitMergeSide,
  type GitMergeState,
  type GitMergeVersion
} from '@front-burner/shared-contracts';
import { isMarkdownName } from '@front-burner/shared-util';
import { Injectable, Logger } from '@nestjs/common';

/** Where git wrote markers. Only a shortcut: a file without them may be one the user already edited. */
const HAS_MARKERS = /^<<<<<<< /m;

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

  /**
   * The text of one version of a conflicting file, resolved or not (GC-17).
   *
   * @throws ApiErrorException `no-merge-in-progress`; `not-conflicting` when
   *   the path is not among the merge's conflicting files;
   *   `version-not-readable` when this version was deleted, is a symbolic
   *   link, not a Markdown file, over the size limit or not valid UTF-8.
   */
  async version(root: string, path: string, side: GitMergeSide): Promise<GitMergeVersion> {
    if (!await this.merge.mergeInProgress(root)) {
      throw new ApiErrorException(409, 'no-merge-in-progress');
    }
    const entry = (await this.merge.conflicts(root)).find(candidate => candidate.path === path);
    if (entry === undefined) {
      throw new ApiErrorException(409, 'not-conflicting');
    }
    const oid = side === 'ours' ? entry.oursOid : entry.theirsOid;
    const mode = side === 'ours' ? entry.oursMode : entry.theirsMode;
    const size = side === 'ours' ? entry.oursSize : entry.theirsSize;
    if (
      oid === null
      || mode === null
      || !REGULAR_FILE.test(mode)
      || !isMarkdownName(path.split('/').at(-1) ?? '')
      || size === null
      || size > EDITABLE_FILE_LIMIT
    ) {
      throw new ApiErrorException(409, 'version-not-readable');
    }
    const content = await this.merge.readVersion(root, oid);
    if (content === null) {
      throw new ApiErrorException(409, 'version-not-readable');
    }
    return { content };
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
    const { path, oursMode, theirsMode } = entry;
    const regular = REGULAR_FILE.test(oursMode ?? '') && REGULAR_FILE.test(theirsMode ?? '');
    if (!regular || !isMarkdownName(path.split('/').at(-1) ?? '')) {
      return false;
    }
    try {
      const text = await this.contents.readTracked(root, path);
      return HAS_MARKERS.test(text) || await this.merge.canWriteMarkers(root, entry);
    } catch (error) {
      if (!(error instanceof PathRefusedError || error instanceof ApiErrorException)) {
        this.logger.warn(`Could not check a conflicting file: ${String(error)}`);
      }
      return false;
    }
  }
}
