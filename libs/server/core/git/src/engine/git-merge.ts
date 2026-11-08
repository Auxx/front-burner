import { inBatches, lstatOrMissing, PathRefusedError, resolveInWorkingCopy } from '@front-burner/server-core-storage';
import { isMarkdownName } from '@front-burner/shared-util';
import { Inject, Injectable } from '@nestjs/common';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GIT_OPTIONS, GitOptions } from '../git.options';
import { GitResult } from '../runner/git-runner';
import { GitOperationError } from './git-errors';
import { LOCAL_MAX_OUTPUT_BYTES, LocalGit, NO_LFS, nulTerminated } from './local-git';

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
  mine: string;
  /** After `>>>>>>>`, such as `origin/main`. */
  theirs: string;
}

/** The branches whose merge message git writes without ` into <branch>`. */
const MAIN_BRANCHES = new Set([ 'main', 'master' ]);

/** At most this many paths are named in `merge-blocked`. */
const MAX_BLOCKING_PATHS = 20;

/** Paths on one command line: 100 of the longest (4,096 bytes) stay well within Linux's 2 MiB. */
const PATHS_PER_COMMAND = 100;

/** A regular file's mode in the index; a symbolic link (120000) or a submodule (160000) has no markers. */
const REGULAR_FILE = /^100(644|755)$/;

/** What a byte that is not valid UTF-8 decodes as. */
const UNDECODABLE = '�';

interface Stage {
  mode: string;
  oid: string;
}

/** A path's entries in the index during a merge: 1 base, 2 mine, 3 theirs (A-5.11). */
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
      await this.prepareConflicts(workingCopy, { mine: request.branch, theirs: request.upstream });
      return { kind: 'conflicted', commits };
    }
    if (fastForward) {
      return { kind: 'fast-forward', commits };
    }
    const head = (await this.local.checked(workingCopy, [ 'rev-parse', 'HEAD' ])).trim();
    return { kind: 'merged', commits, oid: head };
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
   * sees, since `git merge` labels mine `HEAD`. Does nothing for a file that
   * lacks mine or theirs, or that is not a regular file in the index or on disk,
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
    const mine = stages.get(2);
    const theirs = stages.get(3);
    if (
      mine === undefined || theirs === undefined || !REGULAR_FILE.test(mine.mode) || !REGULAR_FILE.test(theirs.mode)
    ) {
      return;
    }
    // Both added: no base, so every line is a conflict, as `git merge` has it.
    const base = stages.get(1)?.oid ?? await this.emptyBlob(workingCopy);
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
        labels.mine,
        '-L',
        'base',
        '-L',
        labels.theirs,
        mine.oid,
        base,
        theirs.oid
      ],
      { timeoutMs: this.options.gitTimeoutMs }
    );
    if (result.timedOut) {
      throw new GitOperationError('timeout', result.stderr);
    }
    // Below 128 it is the number of conflicts. A file with a NUL byte exits 255
    // with no output, which must never replace the file.
    const usable = result.exitCode !== null
      && result.exitCode < 128
      && result.stdoutBytes <= LOCAL_MAX_OUTPUT_BYTES
      && !result.stdout.includes(UNDECODABLE);
    if (!usable) {
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
      await writeFile(entry.absolute, result.stdout);
    }
  }

  /** The unmerged entries under `pathspec`, by path. */
  private async unmerged(workingCopy: string, pathspec: string[]): Promise<Map<string, Stages>> {
    const output = await this.local.checked(workingCopy, [ 'ls-files', '-u', '-z', ...pathspec ]);
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

  private async mergeInProgress(workingCopy: string): Promise<boolean> {
    const result = await this.local.run(workingCopy, [ 'rev-parse', '-q', '--verify', 'MERGE_HEAD' ]);
    return exitAsBoolean(result, 'rev-parse');
  }

  private async isAncestor(workingCopy: string, ancestor: string, descendant: string): Promise<boolean> {
    const result = await this.local.run(workingCopy, [ 'merge-base', '--is-ancestor', ancestor, descendant ], {
      timeoutMs: this.options.gitTimeoutMs
    });
    return exitAsBoolean(result, 'merge-base');
  }
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
