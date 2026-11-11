import { inBatches, lstatOrMissing, PathRefusedError, resolveInWorkingCopy } from '@front-burner/server-core-storage';
import type { GitResolution } from '@front-burner/shared-contracts';
import { isMarkdownName } from '@front-burner/shared-util';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { access, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GIT_OPTIONS, GitOptions } from '../git.options';
import { GitResult } from '../runner/git-runner';
import { GitOperationError, isLockHeld } from './git-errors';
import { authorEnv, LOCAL_MAX_OUTPUT_BYTES, LocalGit, NO_LFS, nulTerminated, UNDECODABLE } from './local-git';

/** Where the commit before a merge is kept, so that git's garbage collection keeps it (A-5.12). */
export const PRE_MERGE_REF = 'refs/front-burner/pre-merge';

export interface MergeRequest {
  /** The current branch. */
  branch: string;
  /** Such as `origin/main`. */
  upstream: string;
  /** Written as git's author and committer (CA-2). */
  author: { name: string; email: string; };
}

/** `commits` is what the upstream had that the branch did not. */
export type MergeResult =
  | { kind: 'up-to-date'; }
  | { kind: 'fast-forward'; commits: number; }
  | { kind: 'merged'; commits: number; oid: string; }
  | { kind: 'conflicted'; commits: number; };

export interface MarkerLabels {
  /** After `<<<<<<<`, such as `main`. */
  ours: string;
  /** After `>>>>>>>`, such as `origin/main`. */
  theirs: string;
}

export type ConflictKind = 'both-changed' | 'both-added' | 'deleted-by-us' | 'deleted-by-them';

/** Where `resolve` and `startOver` keep a file in `.git` until git has done its part. */
const RESOLVE_BACKUP = 'front-burner-resolving';

/** One file a merge could not combine; `null` for a version that does not exist. */
export interface ConflictEntry {
  path: string;
  kind: ConflictKind;
  resolved: boolean;
  baseOid: string | null;
  oursOid: string | null;
  theirsOid: string | null;
  oursMode: string | null;
  theirsMode: string | null;
  /** In bytes; also `null` for a submodule, whose commit has no size in this repository. */
  oursSize: number | null;
  theirsSize: number | null;
  /** What a resolution put in the index; `null` for a file not resolved, or resolved as `delete`. */
  resolution: { mode: string; oid: string; } | null;
  /**
   * Resolved with a file that is neither version, as one the user edited (GC-18).
   * A file resolved as `delete`, or not resolved, is not; one that line-ending
   * normalisation changed when it was added is, which only asks one more question.
   */
  edited: boolean;
}

const BRANCH_PREFIX = 'refs/heads/';

/** The branches whose merge message git writes without ` into <branch>`. */
const MAIN_BRANCHES = new Set([ 'main', 'master' ]);

/** Throws on bytes that are not UTF-8. `ignoreBOM` keeps a BOM, as this text replaces the file. */
const utf8Fatal = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** At most this many paths are named in `merge-blocked`. */
const MAX_BLOCKING_PATHS = 20;

/** Paths on one command line: 100 of the longest (4,096 bytes) stay well within Linux's 2 MiB. */
const PATHS_PER_COMMAND = 100;

/** A regular file's mode in the index; a symbolic link (120000) or a submodule (160000) has no markers. */
export const REGULAR_FILE = /^100(644|755)$/;

interface Stage {
  mode: string;
  oid: string;
}

/** A path's entries in the index during a merge: 1 base, 2 ours, 3 theirs (A-5.11). */
type Stages = Map<number, Stage>;

/**
 * Local merge operations of a working copy. Takes no locks: the caller holds
 * the working-tree lock.
 */
@Injectable()
export class GitMerge {
  private readonly logger = new Logger(GitMerge.name);

  constructor(
    private readonly local: LocalGit,
    @Inject(GIT_OPTIONS) private readonly options: GitOptions
  ) {}

  /** The current commit. */
  async head(workingCopy: string): Promise<string> {
    return (await this.local.checked(workingCopy, [ 'rev-parse', '--verify', 'HEAD' ])).trim();
  }

  /** Keeps the current commit under `PRE_MERGE_REF`; gives it. */
  async record(workingCopy: string): Promise<string> {
    const oid = await this.head(workingCopy);
    await this.keepRecord(workingCopy, oid);
    return oid;
  }

  /** The commit kept under `PRE_MERGE_REF`, or `null` when there is none. */
  async recordedCommit(workingCopy: string): Promise<string | null> {
    const result = await this.local.run(workingCopy, [ 'rev-parse', '-q', '--verify', `${PRE_MERGE_REF}^{commit}` ]);
    return exitAsBoolean(result, 'rev-parse') ? result.stdout.trim() : null;
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
    await this.freeingLocksAtTimeout(
      workingCopy,
      () => this.local.checked(workingCopy, [ 'reset', '-q', '--hard', oid ], { timeoutMs: this.options.gitTimeoutMs })
    );
  }

  /**
   * For a merge with no record to go back to (A-5.12). `git merge --abort` keeps
   * changes that were there before the merge, unlike `resetTo`. It refuses with
   * "Entry not uptodate" when a resolved file differs from the index, and the
   * merge must still end (GC-23), so it then goes back to `HEAD`. That loses such
   * changes, but only in a merge that the product did not start: a pull's working
   * copy was clean (GA-26).
   *
   * @throws GitOperationError `timeout`
   */
  async abort(workingCopy: string): Promise<void> {
    const result = await this.freeingLocksAtTimeout(workingCopy, async () => {
      const run = await this.local.run(workingCopy, [ 'merge', '--abort' ], { timeoutMs: this.options.gitTimeoutMs });
      if (run.timedOut) {
        throw new GitOperationError('timeout', run.stderr);
      }
      return run;
    });
    if (result.exitCode === 0) {
      return;
    }
    if (!await this.mergeInProgress(workingCopy)) {
      throw new Error(`git merge --abort failed: ${result.stderr.trim()}`);
    }
    await this.resetTo(workingCopy, 'HEAD');
  }

  /** A git killed at its timeout can't remove its locks, and they would refuse every retry. */
  private async freeingLocksAtTimeout<T>(workingCopy: string, command: () => Promise<T>): Promise<T> {
    try {
      return await command();
    } catch (error) {
      if (error instanceof GitOperationError && error.code === 'timeout') {
        await this.local.removeOwnLocks(workingCopy);
      }
      throw error;
    }
  }

  /**
   * Whether `HEAD` is what a merge cut short can have left: the recorded commit,
   * or a merge commit made on it. A fast-forward isn't, as moving the branch is
   * the last thing it does, so that one finished. Only a merge makes a commit with
   * two parents, so a commit of the user's on top of the recorded one is never this.
   */
  async isCutShort(workingCopy: string, recorded: string): Promise<boolean> {
    const [ head, firstParent, secondParent ] = (
      await this.local.checked(workingCopy, [ 'rev-list', '--parents', '-n', '1', 'HEAD', '--' ])
    ).trim().split(' ');
    return head === recorded || (firstParent === recorded && secondParent !== undefined);
  }

  /**
   * Undoes a merge or a switch that git did not finish. A killed git leaves locks
   * that make `reset` fail, and a checkout killed partway leaves untracked files
   * that `reset` keeps. The working copy had nothing else untracked (GA-26, GA-39),
   * except what `git status` can't see: ignored files and the user's empty folders,
   * which both stay. A merge's folder always has a file in it, so it goes.
   */
  async undoCutShort(workingCopy: string, oid: string): Promise<void> {
    await this.local.removeOwnLocks(workingCopy);
    await this.resetTo(workingCopy, oid);
    const timeoutMs = this.options.gitTimeoutMs;
    // Without `-d`, it leaves every untracked folder.
    await this.local.checked(workingCopy, [ 'clean', '-fq' ], { timeoutMs });
    const folders = (
      await this.local.checked(
        workingCopy,
        [ 'ls-files', '-z', '--others', '--directory', '--no-empty-directory', '--exclude-standard' ],
        { timeoutMs }
      )
    ).split('\0').filter(path => path !== '');
    for (let start = 0; start < folders.length; start += PATHS_PER_COMMAND) {
      await this.local.checked(
        workingCopy,
        [ '--literal-pathspecs', 'clean', '-fdq', '--', ...folders.slice(start, start + PATHS_PER_COMMAND) ],
        { timeoutMs }
      );
    }
  }

  /**
   * Removes every `*.lock` directly in `.git` and under `.git/refs`: a killed git
   * can leave `HEAD.lock`, `ORIG_HEAD.lock` or a ref's lock as well as
   * `index.lock`. Also `packed-refs.new`, which a killed rewrite of `packed-refs`
   * leaves, and which then stops every later one. Only for the start, when no git
   * command runs (NF-9.4): at any other time a fetch may hold a ref's lock.
   */
  async removeStaleLocks(workingCopy: string): Promise<void> {
    const gitDir = join(workingCopy, '.git');
    const entries = [
      ...await readdir(gitDir, { withFileTypes: true }),
      ...await readdir(join(gitDir, 'refs'), { withFileTypes: true, recursive: true })
    ];
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.lock') || entry.name === 'packed-refs.new')) {
        await rm(join(entry.parentPath, entry.name), { force: true });
      }
    }
  }

  /**
   * Writes what a status would otherwise work out every time, which can take as
   * long as hashing every file (A-5.14). `--unmerged` is needed because git
   * otherwise fails at the conflicting files of a merge waiting for the user.
   */
  async refreshIndex(workingCopy: string): Promise<void> {
    await this.local.checked(workingCopy, [ 'update-index', '-q', '--unmerged', '--refresh' ], {
      timeoutMs: this.options.gitTimeoutMs
    });
  }

  /**
   * Merges the upstream's remote-tracking branch into the current branch, as the
   * author, whatever the working copy's configuration says (GC-5, CA-2, D-4.3).
   * At a conflict, the merge stays in progress, with plain markers labelled with
   * the branch names in each Markdown file (`writeMarkers`). The caller has recorded
   * the commit, holds the working-tree lock and knows the working copy is clean
   * (GA-26).
   *
   * The remote-tracking branch is read once, from its full name, and git merges
   * that commit: a background fetch moves the ref under the network lock only,
   * and the checks must hold for the commit that is merged. git then labels a
   * file's `>>>>>>>` with the commit's id, which only files that are not
   * Markdown keep.
   *
   * Anything thrown after git ran, a timeout or a failure while preparing the
   * conflicts, may leave the merge in progress (`MERGE_HEAD`) or cut short, so
   * the caller undoes it (`undoCutShort`).
   *
   * @throws GitOperationError `merge-blocked`, before anything has changed, when
   *   the merge would write where a file or folder that git does not track is,
   *   or a new path is not valid UTF-8 and cannot be checked;
   *   `timeout`; `failed` when git stopped for another reason.
   */
  async merge(workingCopy: string, request: MergeRequest): Promise<MergeResult> {
    const ref = remoteRef(request.upstream);
    // `--verify` takes one commit, never a range such as `a..b`.
    const oid =
      (await this.local.checked(workingCopy, [ 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}` ]))
        .trim();
    if (await this.isAncestor(workingCopy, oid, 'HEAD')) {
      return { kind: 'up-to-date' };
    }
    const timeoutMs = this.options.gitTimeoutMs;
    const commits = Number(
      await this.local.checked(workingCopy, [ 'rev-list', '--count', oid, '^HEAD', '--' ], { timeoutMs })
    );
    const fastForward = await this.isAncestor(workingCopy, 'HEAD', oid);
    await this.assertNothingInTheWay(workingCopy, oid);
    const result = await this.local.run(
      workingCopy,
      [
        ...NO_LFS,
        '-c',
        'merge.conflictStyle=merge',
        '-c',
        'rerere.enabled=false',
        '-c',
        'commit.gpgsign=false',
        // What `mergeMessage` takes out of the conflict list in MERGE_MSG.
        '-c',
        'core.commentChar=#',
        'merge',
        '--ff',
        '--no-squash',
        '--no-edit',
        '--no-autostash',
        '--no-stat',
        '--no-overwrite-ignore',
        '--allow-unrelated-histories',
        '--no-gpg-sign',
        '-m',
        mergeMessage(request),
        // The commit the checks saw, not the ref, which a fetch may have moved since.
        oid
      ],
      { timeoutMs, env: authorEnv(request.author) }
    );
    if (result.timedOut) {
      throw new GitOperationError('timeout', result.stderr);
    }
    if (result.exitCode !== 0) {
      // The exit code says only that it failed; MERGE_HEAD says it conflicted.
      if (!await this.mergeInProgress(workingCopy)) {
        throw new GitOperationError('failed', result.stderr);
      }
      await this.prepareConflicts(workingCopy, { ours: request.branch, theirs: request.upstream });
      return { kind: 'conflicted', commits };
    }
    if (fastForward) {
      return { kind: 'fast-forward', commits };
    }
    return { kind: 'merged', commits, oid: await this.head(workingCopy) };
  }

  /** Neither the branch nor its upstream has every commit of the other. */
  async needsMergeCommit(workingCopy: string, upstream: string): Promise<boolean> {
    const ref = remoteRef(upstream);
    return !await this.isAncestor(workingCopy, ref, 'HEAD') && !await this.isAncestor(workingCopy, 'HEAD', ref);
  }

  /** The branch has every commit of its upstream, so there is nothing to merge. */
  isUpToDate(workingCopy: string, upstream: string): Promise<boolean> {
    return this.isAncestor(workingCopy, remoteRef(upstream), 'HEAD');
  }

  /** `origin` has the branch, as the last fetch saw it. */
  async hasRemoteBranch(workingCopy: string, branch: string): Promise<boolean> {
    const result = await this.local.run(workingCopy, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/remotes/origin/${branch}`
    ]);
    return exitAsBoolean(result, 'show-ref');
  }

  /** Makes the branch of the same name on `origin` the branch's upstream. */
  async adoptUpstream(workingCopy: string, branch: string): Promise<void> {
    // The key's middle part is everything between the first and last dot, so a dot in the name is fine.
    await this.local.checked(workingCopy, [ 'config', '--replace-all', `branch.${branch}.remote`, 'origin' ]);
    await this.local.checked(workingCopy, [
      'config',
      '--replace-all',
      `branch.${branch}.merge`,
      `refs/heads/${branch}`
    ]);
  }

  /**
   * Writes a conflicting file's plain markers, labelled `labels`, from its
   * versions in the index (GC-5): the one way to write the markers that a user
   * sees, since `git merge` labels ours `HEAD`. Does nothing for a file that
   * lacks ours or theirs, or that is not a regular file in the index or on disk,
   * or when git's output is not UTF-8 text: a file with a NUL byte, or one that
   * is not valid UTF-8, keeps what git wrote.
   */
  async writeMarkers(workingCopy: string, path: string, labels: MarkerLabels): Promise<void> {
    const stages = (await this.unmerged(workingCopy, [ '--', `:(literal)${path}` ])).get(path);
    if (stages !== undefined) {
      await this.writeMarkersFrom(workingCopy, path, stages, labels);
    }
  }

  /**
   * After a conflict: removes each path that has only a base, as a file both
   * sides deleted (no one could resolve it), and writes the markers of the
   * Markdown files among the others. Any other file keeps git's markers, as
   * nothing shows them (GC-15).
   */
  private async prepareConflicts(workingCopy: string, labels: MarkerLabels): Promise<void> {
    const entries = [ ...await this.unmerged(workingCopy, []) ];
    const isBaseOnly = ([ , stages ]: [ string, Stages ]) => stages.size === 1 && stages.has(1);
    const baseOnly = entries.filter(isBaseOnly).map(([ path ]) => path);
    if (baseOnly.length > 0) {
      await this.local.checked(workingCopy, [ 'update-index', '--force-remove', '-z', '--stdin' ], {
        stdin: nulTerminated(baseOnly)
      });
      // The removal records them as resolved, and resolved files are read from
      // there; straight after the merge, nothing else is.
      await this.local.checked(workingCopy, [ 'update-index', '--clear-resolve-undo' ]);
    }
    await inBatches(
      entries.filter(entry => !isBaseOnly(entry) && isMarkdownName(entry[0].split('/').at(-1) ?? '')),
      ([ path, stages ]) => this.writeMarkersFrom(workingCopy, path, stages, labels)
    );
  }

  private async writeMarkersFrom(
    workingCopy: string,
    path: string,
    stages: Stages,
    labels: MarkerLabels
  ): Promise<void> {
    const ours = stages.get(2);
    const theirs = stages.get(3);
    if (
      ours === undefined || theirs === undefined || !REGULAR_FILE.test(ours.mode) || !REGULAR_FILE.test(theirs.mode)
    ) {
      return;
    }
    const text = await this.textWithMarkers(workingCopy, stages.get(1)?.oid ?? null, ours.oid, theirs.oid, labels);
    if (text === null) {
      return;
    }
    let entry;
    try {
      // A folder on the way can be a symbolic link, also when git named the path (A-7.6).
      entry = await resolveInWorkingCopy(workingCopy, path, { symlinkLeaf: true, mayBeMissing: true });
    } catch (error) {
      if (error instanceof PathRefusedError) {
        return;
      }
      throw error;
    }
    if (entry.type === 'file') {
      // The caller holds the working-tree lock, so the entry is still the file just found.
      await writeFile(entry.absolute, text);
    }
  }

  /**
   * The versions merged with plain markers, or `null` when git's output is not
   * UTF-8 text, which must never replace a file.
   */
  private async textWithMarkers(
    workingCopy: string,
    baseOid: string | null,
    oursOid: string,
    theirsOid: string,
    labels: MarkerLabels
  ): Promise<string | null> {
    // Both added: no base, so every line is a conflict, as `git merge` has it.
    const base = baseOid ?? await this.emptyBlob(workingCopy);
    const result = await this.local.run(
      workingCopy,
      [
        // `merge-file` obeys the working copy's `merge.conflictStyle` too.
        '-c',
        'merge.conflictStyle=merge',
        'merge-file',
        '--object-id',
        '-p',
        '-L',
        labels.ours,
        '-L',
        'base',
        '-L',
        labels.theirs,
        oursOid,
        base,
        theirsOid
      ],
      { timeoutMs: this.options.gitTimeoutMs }
    );
    if (result.timedOut) {
      throw new GitOperationError('timeout', result.stderr);
    }
    // Below 128 it is the number of conflicts. A file with a NUL byte exits 255 with no output.
    if (result.exitCode === null || result.exitCode >= 128 || result.stdoutBytes > LOCAL_MAX_OUTPUT_BYTES) {
      return null;
    }
    try {
      return utf8Fatal.decode(result.stdoutRaw);
    } catch {
      return null;
    }
  }

  /**
   * The files of the merge in progress that git could not combine, sorted by
   * path, comparing code units: the unresolved ones from the index, and the
   * resolved ones from what git keeps to undo that (A-4.5). A path with only a
   * base is left out, as a file both sides deleted (`prepareConflicts`). Takes
   * no lock (A-5.3).
   */
  conflicts(workingCopy: string): Promise<ConflictEntry[]> {
    return this.conflictsUnder(workingCopy, []);
  }

  /**
   * One file of `conflicts`, or `null` when the path is not one, read without
   * listing the others. Takes no lock (A-5.3).
   */
  async conflict(workingCopy: string, path: string): Promise<ConflictEntry | null> {
    // A pathspec also matches what is inside a folder of that name.
    const entries = await this.conflictsUnder(workingCopy, [ '--', `:(literal)${path}` ]);
    return entries.find(entry => entry.path === path) ?? null;
  }

  private async conflictsUnder(workingCopy: string, pathspec: string[]): Promise<ConflictEntry[]> {
    const [ unresolved, resolved ] = await Promise.all([
      this.unmerged(workingCopy, pathspec),
      this.stagesFrom(workingCopy, [ '--resolve-undo', ...pathspec ])
    ]);
    // A path in both is unresolved: starting a file over makes it so.
    const byPath = new Map([ ...resolved, ...unresolved ]);
    const [ sizes, resolutions ] = await Promise.all([
      this.blobSizes(workingCopy, [ ...byPath.values() ].flatMap(stages => [ ...stages.values() ])),
      this.mergedEntries(workingCopy, [ ...resolved.keys() ].filter(path => !unresolved.has(path)))
    ]);
    const sizeOf = (stage: Stage | undefined) => stage === undefined ? null : sizes.get(stage.oid) ?? null;
    return [ ...byPath ].sort(([ a ], [ b ]) => a < b ? -1 : 1).flatMap(([ path, stages ]) => {
      const kind = kindOf(stages);
      if (kind === null) {
        return [];
      }
      const ours = stages.get(2);
      const theirs = stages.get(3);
      const resolution = resolutions.get(path) ?? null;
      return [ {
        path,
        kind,
        resolved: !unresolved.has(path),
        baseOid: stages.get(1)?.oid ?? null,
        oursOid: ours?.oid ?? null,
        theirsOid: theirs?.oid ?? null,
        oursMode: ours?.mode ?? null,
        theirsMode: theirs?.mode ?? null,
        oursSize: sizeOf(ours),
        theirsSize: sizeOf(theirs),
        resolution,
        edited: resolution !== null && resolution.oid !== ours?.oid && resolution.oid !== theirs?.oid
      } ];
    });
  }

  /**
   * Whether git can merge the entry's versions as text, so with markers. It can't
   * when a version has a NUL byte, which leaves the file as we had it, with no
   * sign of the conflict: only one side's file, to the user's eye.
   */
  async canWriteMarkers(workingCopy: string, entry: ConflictEntry): Promise<boolean> {
    if (entry.oursOid === null || entry.theirsOid === null) {
      return false;
    }
    const labels = { ours: 'ours', theirs: 'theirs' };
    const text = await this.textWithMarkers(workingCopy, entry.baseOid, entry.oursOid, entry.theirsOid, labels);
    return text !== null;
  }

  /**
   * The current branch and its upstream, such as `origin/main`, which the
   * configuration keeps after a fetch pruned it; each `null` when there is none.
   * Reads no file of the working tree, so its size doesn't matter.
   */
  async branchAndUpstream(workingCopy: string): Promise<{ branch: string | null; upstream: string | null; }> {
    const branch = await this.local.currentBranch(workingCopy);
    if (branch === null) {
      return { branch: null, upstream: null };
    }
    const target = await this.local.upstreamOf(workingCopy, branch);
    return { branch, upstream: target === null ? null : `origin/${target.slice(BRANCH_PREFIX.length)}` };
  }

  /** What the merge has changed apart from `conflicting`, sorted by path: the files git combined by itself (GC-7). */
  async mergedWithoutConflicts(workingCopy: string, conflicting: ReadonlySet<string>): Promise<string[]> {
    const output = await this.local.checked(workingCopy, [
      '--no-optional-locks',
      'diff-index',
      '--cached',
      '--name-only',
      '-z',
      '--no-renames',
      'HEAD'
    ]);
    return output.split('\0').filter(path => path !== '' && !conflicting.has(path)).sort();
  }

  /**
   * The message git prepared for the merge commit (GC-20), without its comment
   * lines, such as the "# Conflicts:" list, and trailing blank lines. Empty when
   * git has none, which the user then writes.
   */
  async mergeMessage(workingCopy: string): Promise<string> {
    const message = await readFile(join(workingCopy, '.git', 'MERGE_MSG'), 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return '';
      }
      throw error;
    });
    return message.split('\n').filter(line => !line.startsWith('#')).join('\n').trimEnd();
  }

  /** The size of each blob among `stages`, by id, read with one command. A submodule's commit has none. */
  private async blobSizes(workingCopy: string, stages: Stage[]): Promise<Map<string, number>> {
    const oids = [ ...new Set(stages.map(({ oid }) => oid)) ];
    if (oids.length === 0) {
      return new Map();
    }
    const output = await this.local.checked(workingCopy, [ '--no-optional-locks', 'cat-file', '--batch-check' ], {
      stdin: `${oids.join('\n')}\n`
    });
    const sizes = new Map<string, number>();
    for (const line of output.split('\n')) {
      const [ oid = '', type, size ] = line.split(' ');
      if (type === 'blob') {
        sizes.set(oid, Number(size));
      }
    }
    return sizes;
  }

  /** The stage-0 entry of each of `paths` that has one, by path: what a resolution put in the index. */
  private async mergedEntries(workingCopy: string, paths: string[]): Promise<Map<string, Stage>> {
    const byPath = new Map<string, Stage>();
    const wanted = new Set(paths);
    const batches: string[][] = [];
    for (let start = 0; start < paths.length; start += PATHS_PER_COMMAND) {
      batches.push(paths.slice(start, start + PATHS_PER_COMMAND));
    }
    await inBatches(batches, async batch => {
      const output = await this.local.checked(workingCopy, [
        '--no-optional-locks',
        '--literal-pathspecs',
        'ls-files',
        '-z',
        '--stage',
        '--',
        ...batch
      ]);
      for (const record of output.split('\0')) {
        const match = /^(\d+) ([0-9a-f]+) 0\t(.*)$/s.exec(record);
        // A pathspec also matches what is inside a folder of that name.
        if (match !== null && wanted.has(match[3] ?? '')) {
          byPath.set(match[3] ?? '', { mode: match[1] ?? '', oid: match[2] ?? '' });
        }
      }
    });
    return byPath;
  }

  /** The unmerged entries under `pathspec`, by path. */
  private unmerged(workingCopy: string, pathspec: string[]): Promise<Map<string, Stages>> {
    return this.stagesFrom(workingCopy, [ '-u', ...pathspec ]);
  }

  /** The stages `ls-files` lists with `options`, by path; `--resolve-undo` writes them as `-u` does. */
  private async stagesFrom(workingCopy: string, options: string[]): Promise<Map<string, Stages>> {
    const output = await this.local.checked(workingCopy, [ '--no-optional-locks', 'ls-files', '-z', ...options ]);
    const byPath = new Map<string, Stages>();
    for (const record of output.split('\0')) {
      const match = /^(\d+) ([0-9a-f]+) ([123])\t(.*)$/s.exec(record);
      if (match !== null) {
        const [ , mode = '', oid = '', stage = '', path = '' ] = match;
        const stages = byPath.get(path) ?? new Map<number, Stage>();
        stages.set(Number(stage), { mode, oid });
        byPath.set(path, stages);
      }
    }
    return byPath;
  }

  private async emptyBlob(workingCopy: string): Promise<string> {
    return (await this.local.checked(workingCopy, [ 'hash-object', '-w', '-t', 'blob', '--stdin' ], { stdin: '' }))
      .trim();
  }

  /**
   * Refuses when the merge would write a new file where an entry that git does
   * not track is, or where a folder on the way to it must be: a true merge
   * replaces an ignored file without a word, and `--no-overwrite-ignore`
   * protects it only in a fast-forward. The working copy is clean (GA-26), so
   * such an entry is ignored, and aborting could not bring it back.
   */
  private async assertNothingInTheWay(workingCopy: string, oid: string): Promise<void> {
    const timeoutMs = this.options.gitTimeoutMs;
    const added = (
      await this.local.checked(
        workingCopy,
        [ 'diff-tree', '-r', '--name-only', '-z', '--no-renames', '--diff-filter=A', 'HEAD', oid ],
        { timeoutMs }
      )
    ).split('\0').filter(path => path !== '');
    // Decoded, such a name is not the one on disk, so what is there cannot be checked.
    const undecodable = added.filter(path => path.includes(UNDECODABLE));
    if (undecodable.length > 0) {
      throw new GitOperationError('merge-blocked', 'The merge would add paths that are not valid UTF-8.', {
        paths: undecodable.slice(0, MAX_BLOCKING_PATHS).join('\n')
      });
    }
    const entries = new Map<string, ReturnType<typeof lstatOrMissing>>();
    const entryAt = (path: string) => {
      let entry = entries.get(path);
      if (entry === undefined) {
        entry = lstatOrMissing(join(workingCopy, path));
        entries.set(path, entry);
      }
      return entry;
    };
    const inTheWay = new Set<string>();
    await inBatches(added, async path => {
      const segments = path.split('/');
      for (let depth = 1; depth < segments.length; depth++) {
        const parent = segments.slice(0, depth).join('/');
        const entry = await entryAt(parent);
        if (entry === undefined) {
          return;
        }
        if (!entry.isDirectory()) {
          inTheWay.add(parent);
          return;
        }
      }
      if (await entryAt(path) !== undefined) {
        inTheWay.add(path);
      }
    });
    // A tracked entry, such as a file the other side turned into a folder, is git's to replace.
    // `ls-files` takes no pathspec on its standard input, so the paths go in groups.
    const candidates = [ ...inTheWay ];
    const untracked: string[] = [];
    for (
      let start = 0;
      start < candidates.length && untracked.length < MAX_BLOCKING_PATHS;
      start += PATHS_PER_COMMAND
    ) {
      const output = await this.local.checked(
        workingCopy,
        [
          '--literal-pathspecs',
          'ls-files',
          '-z',
          '--others',
          '--directory',
          '--',
          ...candidates.slice(start, start + PATHS_PER_COMMAND)
        ],
        { timeoutMs }
      );
      untracked.push(...output.split('\0').filter(path => path !== '').map(path => path.replace(/\/$/, '')));
    }
    if (untracked.length > 0) {
      throw new GitOperationError('merge-blocked', 'The merge would overwrite files that git does not track.', {
        paths: untracked.slice(0, MAX_BLOCKING_PATHS).join('\n')
      });
    }
  }

  /**
   * Read a blob by its object id and return its raw bytes. The object id comes
   * from the index, so any git failure (missing object, corrupt store, permissions)
   * is abnormal and throws. The caller decodes the bytes with `decodeMarkdown`
   * from the files library. Used outside the working-tree lock.
   *
   * @throws GitOperationError `timeout` when it ran out of time.
   * @throws Error when git fails for any reason (non-zero exit, spawn error, killed process,
   *          corrupt store, missing object, permissions).
   */
  async readVersion(workingCopy: string, oid: string): Promise<Buffer> {
    const result = await this.local.run(
      workingCopy,
      [ 'cat-file', 'blob', oid ],
      { timeoutMs: this.options.gitTimeoutMs }
    );
    if (result.timedOut) {
      throw new GitOperationError('timeout', result.stderr);
    }
    // The oid comes from the index, so any non-zero exit is abnormal and should be
    // logged as a server error rather than silently swallowed.
    if (result.exitCode !== 0) {
      throw new Error(`git cat-file blob ${oid} failed: ${result.stderr.trim()}`);
    }
    return result.stdoutRaw;
  }

  /**
   * Resolves one conflicting file, which the caller has checked that the
   * resolution suits (GC-14 to GC-16): `mark-resolved` adds it as it is on disk,
   * `ours` and `theirs` put that whole version there first, byte for byte and
   * with its mode, `keep` puts the version that exists there, and `delete`
   * removes the file and its entries. Each records the file as resolved, so that
   * the merge still lists it (A-4.5). Nothing else is touched (GC-19). The caller
   * holds the working-tree lock, and has checked that the path is not a folder.
   *
   * All or nothing (GC-27): until git has recorded the resolution, the file
   * waits in `.git`, not deleted; if git fails, the file and its conflict are
   * put back as they were. Renamed, not copied, so a large file costs nothing.
   *
   * @throws PathRefusedError when the path is reached through a symbolic link (A-7.6).
   * @throws GitOperationError `timeout`
   */
  async resolve(workingCopy: string, entry: ConflictEntry, resolution: GitResolution): Promise<void> {
    const { path } = entry;
    const onStdin = { stdin: nulTerminated([ path ]), timeoutMs: this.options.gitTimeoutMs };
    // Each path read literally: `:(top)x.md` is a file's name, not a pathspec.
    const literal = [ '--literal-pathspecs' ];
    const fromStdin = [ '--pathspec-from-file=-', '--pathspec-file-nul' ];
    const add = () => this.local.checked(workingCopy, [ ...literal, 'add', '-A', ...fromStdin ], onStdin);
    if (resolution === 'mark-resolved') {
      // One write of the index, under its lock: there is nothing to put back.
      await this.freeingLocksAtTimeout(workingCopy, add);
      return;
    }
    await this.withFileSetAside(
      workingCopy,
      path,
      () =>
        this.freeingLocksAtTimeout(workingCopy, async () => {
          if (resolution === 'delete') {
            await this.local.checked(workingCopy, [ 'update-index', '--force-remove', '-z', '--stdin' ], onStdin);
            return;
          }
          const side = resolution === 'keep' ? (entry.oursOid === null ? 'theirs' : 'ours') : resolution;
          await this.local.checked(
            workingCopy,
            [ ...NO_LFS, ...literal, 'checkout', `--${side}`, ...fromStdin ],
            onStdin
          );
          await add();
        }),
      // Its stages from what git keeps to undo a resolution, if git recorded it.
      async () => {
        if (!await this.isUnmerged(workingCopy, path)) {
          await this.unresolve(workingCopy, path);
        }
      }
    );
  }

  /**
   * Runs `change` with the file at `path` waiting in `.git`, not deleted, so that
   * a change is all or nothing (GC-27). Renamed, not copied, so a large file
   * costs nothing. If `change` fails, `undo` puts the index back, then the file
   * comes back from `.git`, or no file when there was none.
   *
   * @throws PathRefusedError when the path is reached through a symbolic link (A-7.6).
   */
  private async withFileSetAside(
    workingCopy: string,
    path: string,
    change: (absolute: string) => Promise<void>,
    undo: () => Promise<void>
  ): Promise<void> {
    const { absolute, type } = await resolveInWorkingCopy(workingCopy, path, { symlinkLeaf: true, mayBeMissing: true });
    if (type === 'folder' || type === 'other') {
      throw new Error(`Not a file: ${path}`);
    }
    const backup = join(workingCopy, '.git', RESOLVE_BACKUP);
    // What a backend stopped mid-way left; the merge's own file was put back or resolved.
    await rm(backup, { force: true, recursive: true });
    const saved = type !== 'missing';
    if (saved) {
      await rename(absolute, backup);
    }
    try {
      await change(absolute);
    } catch (error) {
      await undo();
      await rm(absolute, { force: true });
      if (saved) {
        await rename(backup, absolute);
      }
      throw error;
    }
    if (saved) {
      // The change is done: a backup left behind goes at the next one, and must not make this one look failed.
      await rm(backup, { force: true }).catch((error: unknown) => {
        this.logger.warn(`Could not remove ${backup}: ${String(error)}`);
      });
    }
  }

  private async isUnmerged(workingCopy: string, path: string): Promise<boolean> {
    return (await this.unmerged(workingCopy, [ '--', `:(literal)${path}` ])).has(path);
  }

  /** Brings back a resolved file's stages. Takes paths only as arguments, which are names and never pathspecs. */
  private async unresolve(workingCopy: string, path: string): Promise<void> {
    await this.local.checked(workingCopy, [ 'update-index', '--unresolve', '--', path ], {
      timeoutMs: this.options.gitTimeoutMs
    });
  }

  /**
   * Puts a resolved file back as the merge left it (GC-18): its stages come back
   * from what git keeps to undo the resolution (`git update-index --unresolve`),
   * and the file on disk is my version, or theirs when I deleted it, byte for byte
   * and with its mode. A Markdown file whose versions git can merge as text gets
   * the markers that `writeMarkers` writes, labelled `labels`; one that does not
   * decode keeps my version. Not `git checkout -m`, which labels the markers
   * `ours` and `theirs` (GC-5). Nothing else is touched (GC-19). The caller holds
   * the working-tree lock and has checked that the file is resolved.
   *
   * All or nothing (GC-27), as `resolve` is: the file waits in `.git` until git
   * has its stages back, and if git fails, the file and its resolution are put back.
   *
   * @throws PathRefusedError when the path is reached through a symbolic link (A-7.6).
   * @throws GitOperationError `timeout`
   */
  async startOver(workingCopy: string, entry: ConflictEntry, labels: MarkerLabels): Promise<void> {
    const { path } = entry;
    // Worked out before anything changes, so that nothing is left half done.
    const markers = await this.markersOf(workingCopy, entry, labels);
    await this.withFileSetAside(
      workingCopy,
      path,
      async absolute => {
        await this.freeingLocksAtTimeout(workingCopy, async () => {
          await this.unresolve(workingCopy, path);
          const side = entry.oursOid === null ? 'theirs' : 'ours';
          await this.local.checked(
            workingCopy,
            [
              ...NO_LFS,
              '--literal-pathspecs',
              'checkout',
              `--${side}`,
              '--pathspec-from-file=-',
              '--pathspec-file-nul'
            ],
            { stdin: nulTerminated([ path ]), timeoutMs: this.options.gitTimeoutMs }
          );
        });
        if (markers !== null) {
          // git has just written a regular file there, which this replaces.
          await writeFile(absolute, markers);
        }
      },
      () => this.undoStartOver(workingCopy, path, entry.resolution)
    );
  }

  /** The markers of a Markdown file whose versions are both regular files that git can merge as text; else `null`. */
  private async markersOf(workingCopy: string, entry: ConflictEntry, labels: MarkerLabels): Promise<string | null> {
    const { path, baseOid, oursOid, theirsOid, oursMode, theirsMode } = entry;
    if (
      oursOid === null || theirsOid === null || !REGULAR_FILE.test(oursMode ?? '')
      || !REGULAR_FILE.test(theirsMode ?? '') || !isMarkdownName(path.split('/').at(-1) ?? '')
    ) {
      return null;
    }
    return this.textWithMarkers(workingCopy, baseOid, oursOid, theirsOid, labels);
  }

  /**
   * Puts a file's resolution back in the index after `startOver` failed partway:
   * the entry `resolution` names, or none for a file resolved as deleted. Either
   * also records the stages to undo it again.
   */
  private async undoStartOver(
    workingCopy: string,
    path: string,
    resolution: ConflictEntry['resolution']
  ): Promise<void> {
    if (!await this.isUnmerged(workingCopy, path)) {
      return;
    }
    await (resolution === null
      ? this.local.checked(workingCopy, [ 'update-index', '--force-remove', '-z', '--stdin' ], {
        stdin: nulTerminated([ path ])
      })
      : this.local.checked(workingCopy, [ 'update-index', '-z', '--index-info' ], {
        stdin: nulTerminated([ `${resolution.mode} ${resolution.oid} 0\t${path}` ])
      }));
  }

  /**
   * Commits the merge in progress with the index as it stands, which is the
   * merge's result: the resolved files and what merged by itself (GC-20). Unlike
   * `GitEngine.commit`, it neither empties the index nor adds files, so a change
   * on disk that is not in the index stays out. `MERGE_HEAD` gives the second
   * parent, also when the result is the same as `HEAD`. The message is kept as
   * written, lines starting with `#` included (GA-21), and the author beats the
   * working copy's configuration (CA-2). The caller holds the working-tree lock
   * and knows that no file is unresolved.
   *
   * A failure leaves the merge as it was (GC-27), without the locks of a git
   * killed at its timeout. A git killed after it made the commit has committed,
   * though: that commit is the answer, and what is left of the merge goes.
   *
   * @returns the merge commit, and the commit it was made on.
   * @throws GitOperationError `detached-head`, before anything changed, as a
   *   commit on no branch is lost at the next switch; `git-busy`; `timeout`
   */
  async commit(
    workingCopy: string,
    request: { message: string; author: { name: string; email: string; }; }
  ): Promise<{ oid: string; parent: string; }> {
    const onBranch = await this.local.run(workingCopy, [ 'symbolic-ref', '-q', 'HEAD' ]);
    if (!exitAsBoolean(onBranch, 'symbolic-ref')) {
      throw new GitOperationError('detached-head', 'HEAD is not on a branch.');
    }
    const [ parent, theirs ] = await Promise.all([ this.head(workingCopy), this.mergeHead(workingCopy) ]);
    try {
      const result = await this.freeingLocksAtTimeout(workingCopy, async () => {
        const run = await this.local.run(
          workingCopy,
          [ '-c', 'commit.gpgsign=false', 'commit', '--cleanup=whitespace', '--no-edit', '-F', '-' ],
          { stdin: request.message, timeoutMs: this.options.gitTimeoutMs, env: authorEnv(request.author) }
        );
        if (run.timedOut) {
          throw new GitOperationError('timeout', run.stderr);
        }
        return run;
      });
      if (result.exitCode !== 0) {
        if (isLockHeld(result.stderr)) {
          throw new GitOperationError('git-busy', result.stderr);
        }
        throw new Error(`git commit failed: ${result.stderr.trim()}`);
      }
    } catch (error) {
      const oid = error instanceof GitOperationError && error.code === 'timeout'
        ? await this.committedAnyway(workingCopy, parent, theirs)
        : null;
      if (oid === null) {
        throw error;
      }
      return { oid, parent };
    }
    return { oid: await this.head(workingCopy), parent };
  }

  /**
   * The merge commit that a git killed at its timeout made all the same: `HEAD`
   * with the two parents of this merge. git moves the branch before it removes
   * `MERGE_HEAD`, so that is removed when it is still there, leaving the files
   * and the index as they are. `null` when there is no such commit.
   */
  private async committedAnyway(workingCopy: string, parent: string, theirs: string): Promise<string | null> {
    const [ head, ...parents ] = (
      await this.local.checked(workingCopy, [ 'rev-list', '--parents', '-n', '1', 'HEAD', '--' ])
    ).trim().split(' ');
    if (parents.length !== 2 || parents[0] !== parent || parents[1] !== theirs) {
      return null;
    }
    if (await this.mergeInProgress(workingCopy)) {
      await this.local.checked(workingCopy, [ 'merge', '--quit' ]);
    }
    return head ?? null;
  }

  /** The commit being merged; the first line of `MERGE_HEAD`, as the product merges one commit. */
  private async mergeHead(workingCopy: string): Promise<string> {
    const content = await readFile(join(workingCopy, '.git', 'MERGE_HEAD'), 'utf8');
    return content.split('\n')[0]?.trim() ?? '';
  }

  /**
   * Whether git still has a path that is not resolved. Read from the index, as
   * git's commit checks, so also a path that `conflicts` leaves out, such as one
   * both sides deleted in a merge that the product did not start.
   */
  async hasUnmerged(workingCopy: string): Promise<boolean> {
    return (await this.unmerged(workingCopy, [])).size > 0;
  }

  /** A merge, as opposed to `GitEngine.mergeInProgress`, which a rebase also answers yes to. */
  async mergeInProgress(workingCopy: string): Promise<boolean> {
    // The file, not `rev-parse`: that also finds a branch called `MERGE_HEAD`.
    return access(join(workingCopy, '.git', 'MERGE_HEAD')).then(() => true, () => false);
  }

  private async isAncestor(workingCopy: string, ancestor: string, descendant: string): Promise<boolean> {
    const result = await this.local.run(workingCopy, [ 'merge-base', '--is-ancestor', ancestor, descendant ], {
      timeoutMs: this.options.gitTimeoutMs
    });
    return exitAsBoolean(result, 'merge-base');
  }
}

/** The kind that the stages a path has say; `null` for one with only a base, which both sides deleted. */
function kindOf(stages: Stages): ConflictKind | null {
  const ours = stages.has(2);
  const theirs = stages.has(3);
  if (ours && theirs) {
    return stages.has(1) ? 'both-changed' : 'both-added';
  }
  if (theirs) {
    return 'deleted-by-us';
  }
  return ours ? 'deleted-by-them' : null;
}

/** The full name: a local branch named `origin/main` would take the short name's place. */
function remoteRef(upstream: string): string {
  if (!upstream.startsWith('origin/')) {
    throw new Error(`Not a branch of origin: ${upstream}`);
  }
  return `refs/remotes/${upstream}`;
}

/** git's own words for merging the short name (GC-20), which a full ref does not get. */
function mergeMessage({ branch, upstream }: MergeRequest): string {
  const into = MAIN_BRANCHES.has(branch) ? '' : ` into ${branch}`;
  return `Merge remote-tracking branch '${upstream}'${into}`;
}

/** Exit 0 is yes and 1 is no; anything else is a failure. */
function exitAsBoolean(result: GitResult, command: string): boolean {
  if (result.timedOut) {
    throw new GitOperationError('timeout', result.stderr);
  }
  if (result.exitCode === 0 || result.exitCode === 1) {
    return result.exitCode === 0;
  }
  throw new Error(`git ${command} failed: ${result.stderr.trim()}`);
}
