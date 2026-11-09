import { inBatches, lstatOrMissing, PathRefusedError, resolveInWorkingCopy } from '@front-burner/server-core-storage';
import { isMarkdownName } from '@front-burner/shared-util';
import { Inject, Injectable } from '@nestjs/common';
import { access, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GIT_OPTIONS, GitOptions } from '../git.options';
import { GitResult } from '../runner/git-runner';
import { GitOperationError } from './git-errors';
import { LOCAL_MAX_OUTPUT_BYTES, LocalGit, NO_LFS, nulTerminated, UNDECODABLE } from './local-git';

/** Fatal decoder — throws when the input contains bytes that are not valid UTF-8, preserves BOM. */
const utf8Fatal = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

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
}

const BRANCH_PREFIX = 'refs/heads/';

/** The branches whose merge message git writes without ` into <branch>`. */
const MAIN_BRANCHES = new Set([ 'main', 'master' ]);

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
    const { name, email } = request.author;
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
      {
        timeoutMs,
        // These beat every git configuration, including the working copy's (CA-2).
        env: {
          GIT_AUTHOR_NAME: name,
          GIT_AUTHOR_EMAIL: email,
          GIT_COMMITTER_NAME: name,
          GIT_COMMITTER_EMAIL: email
        }
      }
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
  async conflicts(workingCopy: string): Promise<ConflictEntry[]> {
    const [ unresolved, resolved ] = await Promise.all([
      this.unmerged(workingCopy, []),
      this.stagesFrom(workingCopy, [ '--resolve-undo' ])
    ]);
    // A path in both is unresolved: starting a file over makes it so.
    const byPath = new Map([ ...resolved, ...unresolved ]);
    const sizes = await this.blobSizes(workingCopy, [ ...byPath.values() ].flatMap(stages => [ ...stages.values() ]));
    const sizeOf = (stage: Stage | undefined) => stage === undefined ? null : sizes.get(stage.oid) ?? null;
    return [ ...byPath ].sort(([ a ], [ b ]) => a < b ? -1 : 1).flatMap(([ path, stages ]) => {
      const kind = kindOf(stages);
      if (kind === null) {
        return [];
      }
      const ours = stages.get(2);
      const theirs = stages.get(3);
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
        theirsSize: sizeOf(theirs)
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
   * Read a blob by its object id, returning its text content, or `null` when it
   * does not exist, is not a blob, or is not valid UTF-8 (A-5.11). Used outside
   * the working-tree lock.
   *
   * @throws GitOperationError `timeout` when it ran out of time.
   * @throws Error when git itself fails (spawn error, killed process, corrupt store).
   */
  async readVersion(workingCopy: string, oid: string): Promise<string | null> {
    const result = await this.local.run(
      workingCopy,
      [ 'cat-file', 'blob', oid ],
      { timeoutMs: this.options.gitTimeoutMs }
    );
    if (result.timedOut) {
      throw new GitOperationError('timeout', result.stderr);
    }
    // Exit 128 means the object does not exist or is not a blob — the expected "not found" case.
    if (result.exitCode === 128) {
      return null;
    }
    if (result.exitCode !== 0) {
      throw new Error(`git cat-file blob ${oid} failed: ${result.stderr.trim()}`);
    }
    if (result.stdoutBytes > LOCAL_MAX_OUTPUT_BYTES) {
      return null;
    }
    try {
      let text = utf8Fatal.decode(result.stdoutRaw);
      // Normalise like the editor's decodeMarkdown: strip BOM and convert CRLF to LF.
      if (text.startsWith('\uFEFF')) {
        text = text.slice(1);
      }
      return text.replace(/\r\n/g, '\n');
    } catch {
      return null;
    }
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
