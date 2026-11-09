import { Inject, Injectable } from '@nestjs/common';
import { GIT_OPTIONS, GitOptions } from '../git.options';
import { classifyBranchFailure, GitOperationError } from './git-errors';
import { GitMerge } from './git-merge';
import { FIRST_BRANCH } from './git-status';
import { LocalGit, NO_LFS, UNDECODABLE } from './local-git';

export interface LocalBranch {
  name: string;
  /** Such as `origin/main`; `null` for an unpublished branch. */
  upstream: string | null;
}

export interface RemoteBranch {
  /** Such as `origin/feature`. */
  name: string;
  /** Such as `feature`. */
  branch: string;
}

export interface BranchList {
  /** `null` on a detached `HEAD`, and on a branch whose name is not valid UTF-8, which no list has. */
  current: string | null;
  /** Sorted by name, comparing code units, so that the order is the same on every device. */
  local: LocalBranch[];
  /** The branches of `origin` that no local branch has the name of or tracks (GA-36), sorted as `local`. */
  remote: RemoteBranch[];
}

const HEADS = 'refs/heads/';
const REMOTES = 'refs/remotes/';
const ORIGIN = `${REMOTES}origin/`;

/** A ref is a file, with `.lock` added while it is written; most file systems allow 255 bytes per name. */
const MAX_SEGMENT_BYTES = 250;
/** Far above any real branch, and well below what a path may be with the data folder before it. */
const MAX_NAME_BYTES = 1024;
/** Git looks for these before branches, so a branch of such a name changes what they mean (see `git rev-parse`). */
const GITS_OWN_REF =
  /^([A-Z_-]*_HEAD|AUTO_MERGE|BISECT_EXPECTED_REV|NOTES_MERGE_PARTIAL|NOTES_MERGE_REF|MERGE_AUTOSTASH)$/;

/**
 * What `git check-ref-format --branch` allows, or can't be asked, and git can't
 * use as a branch: a NUL, which can't be in a process's argument; `@`, which it
 * reads as `HEAD` when switching; its own refs; and a name too long for a file.
 */
const isUnusableName = (name: string) =>
  name.includes('\0')
  || name === '@'
  || GITS_OWN_REF.test(name)
  || Buffer.byteLength(name) > MAX_NAME_BYTES
  || name.split('/').some(segment => Buffer.byteLength(segment) > MAX_SEGMENT_BYTES);

const byName = (a: { name: string; }, b: { name: string; }) => {
  if (a.name === b.name) {
    return 0;
  }
  return a.name < b.name ? -1 : 1;
};

/**
 * The branches of a working copy, as of the last fetch, and moving between them.
 * Takes no locks: `list` only reads refs, so it runs outside the working-tree
 * lock, and the caller holds that lock for the others (A-5.3).
 */
@Injectable()
export class GitBranches {
  constructor(
    private readonly local: LocalGit,
    private readonly merge: GitMerge,
    @Inject(GIT_OPTIONS) private readonly options: GitOptions
  ) {}

  /**
   * Switches to a local branch (GA-37). The caller checks that the working copy
   * is clean (GA-39), which is what makes it safe to put the files back after a
   * timeout. Only a branch of exactly this name will do: git also reads `-` and
   * `@{-1}` as the previous branch. Before the first commit, `main` is the branch
   * the list gives (GA-42), and has no ref: the working copy is already there.
   *
   * @throws GitOperationError `branch-not-found`, `switch-blocked`, `git-busy`, `timeout`
   */
  async switchTo(workingCopy: string, name: string): Promise<void> {
    if (!await this.isLocalBranch(workingCopy, name)) {
      if (name === FIRST_BRANCH && await this.hasNoCommits(workingCopy)) {
        return;
      }
      throw new GitOperationError('branch-not-found', `no local branch ${name}`);
    }
    await this.switchFiles(workingCopy, name);
  }

  /**
   * Makes a local branch of the same name that tracks a branch of `origin`, and
   * switches to it (GA-37). As `switchTo`, for the caller and for ignored files.
   * The full ref, as a local branch can be called `origin/<branch>`.
   *
   * Two steps, not `git switch --track -c`: that changes the files first, and
   * leaves them changed when it then can't make the branch. A branch that can't
   * be switched to, or whose upstream can't be set, doesn't stay.
   *
   * @throws GitOperationError `branch-name-invalid`, `branch-exists`, `branch-name-conflict`,
   *   `branch-not-found`, `switch-blocked`, `git-busy`, `timeout`
   */
  async trackRemote(workingCopy: string, branch: string): Promise<void> {
    await this.checkName(workingCopy, branch);
    if (await this.isLocalBranch(workingCopy, branch)) {
      throw new GitOperationError('branch-exists', `a local branch ${branch}`);
    }
    try {
      await this.branchCommand(workingCopy, branch, [ 'branch', '--quiet', '--track', branch, `${ORIGIN}${branch}` ]);
      await this.switchFiles(workingCopy, branch);
    } catch (error) {
      // Git refuses to delete the current branch, which a switch killed at its very end has made it.
      await this.local.run(workingCopy, [ 'branch', '--quiet', '-D', '--', branch ]);
      throw error;
    }
  }

  /**
   * Makes a branch from the current commit and switches to it, keeping any
   * uncommitted changes; it is unpublished until its first push (GA-38), also
   * when `origin` has a branch of that name. Refused without commits, as the
   * first commit makes `main` whatever the branch is called (GA-42).
   *
   * @throws GitOperationError `branch-name-invalid`, `no-commits`, `branch-exists`,
   *   `branch-name-conflict`, `git-busy`, `timeout`
   */
  async create(workingCopy: string, name: string): Promise<void> {
    await this.checkName(workingCopy, name);
    if (await this.hasNoCommits(workingCopy)) {
      throw new GitOperationError('no-commits', 'nothing to start a branch from');
    }
    // No `git reset` after a timeout: no file changes, and the uncommitted changes are the user's.
    await this.branchCommand(workingCopy, name, [
      ...NO_LFS,
      'switch',
      '--quiet',
      '--no-guess',
      '--no-track',
      '-c',
      name
    ]);
  }

  /** A NUL can't be in a process's argument, and can't be in a branch's name. */
  private async isLocalBranch(workingCopy: string, name: string): Promise<boolean> {
    if (name.includes('\0')) {
      return false;
    }
    const result = await this.local.run(workingCopy, [ 'show-ref', '--verify', '--quiet', `${HEADS}${name}` ]);
    if (result.timedOut) {
      throw new GitOperationError('timeout', result.stderr);
    }
    return result.exitCode === 0;
  }

  /**
   * Git's own rules (GA-38), which also refuse a leading `-`. `--branch` expands
   * `@{-1}` and prints what it means, so a name passes only when it comes back the
   * same. Those rules let through what git then can't use as a branch: see
   * `isUnusableName`.
   */
  private async checkName(workingCopy: string, name: string): Promise<void> {
    const invalid = new GitOperationError('branch-name-invalid', `not a branch name: ${name.slice(0, 300)}`);
    if (isUnusableName(name)) {
      throw invalid;
    }
    const result = await this.local.run(workingCopy, [ 'check-ref-format', '--branch', name ]);
    if (result.timedOut) {
      throw new GitOperationError('timeout', result.stderr);
    }
    if (result.exitCode !== 0 || result.stdout.trim() !== name) {
      throw invalid;
    }
  }

  /**
   * Switches a clean working copy to an existing branch. A git killed at its
   * timeout has rewritten only some of the files, so they go back to `HEAD`. If
   * that fails too, the timeout is still what happened, and **Changes** shows the rest.
   */
  private async switchFiles(workingCopy: string, branch: string): Promise<void> {
    try {
      // The `--` is not optional: without it, `--orphan=boom` empties the working copy.
      await this.branchCommand(
        workingCopy,
        branch,
        [ ...NO_LFS, 'switch', '--quiet', '--no-guess', '--no-overwrite-ignore', '--', branch ]
      );
    } catch (error) {
      if (error instanceof GitOperationError && error.code === 'timeout') {
        await this.merge.undoCutShort(workingCopy, 'HEAD').catch(() => undefined);
      }
      throw error;
    }
  }

  /** Runs a command that makes or moves to `branch`, giving its failure a code, and freeing its locks at a timeout. */
  private async branchCommand(workingCopy: string, branch: string, args: string[]): Promise<void> {
    const result = await this.local.run(workingCopy, args, { timeoutMs: this.options.gitTimeoutMs });
    if (result.timedOut) {
      await this.local.removeOwnLocks(workingCopy, [ `${HEADS}${branch}` ]);
      throw new GitOperationError('timeout', result.stderr);
    }
    if (result.exitCode !== 0) {
      const code = classifyBranchFailure(result.stderr);
      if (code === null) {
        throw new Error(
          `git ${args.find(arg => arg === 'switch' || arg === 'branch')} failed: ${result.stderr.trim()}`
        );
      }
      throw new GitOperationError(code, result.stderr);
    }
  }

  /**
   * The local branches, and the remote ones to offer next to them (GA-36, GA-41,
   * GA-42). A name that is not valid UTF-8 is left out: it can't be shown as it
   * is, and an altered one names no branch.
   */
  async list(workingCopy: string): Promise<BranchList> {
    // One after the other, in this order, as a branch can change meanwhile: a commit
    // never makes the first read wrong, and refs read last include what `HEAD` named.
    const noCommits = await this.hasNoCommits(workingCopy);
    const head = noCommits ? FIRST_BRANCH : await this.local.currentBranch(workingCopy);
    const refs = await this.local.checked(workingCopy, [
      'for-each-ref',
      '--format=%(refname)%00%(upstream)%00%(symref)',
      'refs/heads',
      'refs/remotes/origin'
    ]);

    const entries = refs.split('\n').filter(line => line !== '').map(line => {
      const [ ref = '', upstream = '', symref = '' ] = line.split('\0');
      return { ref, upstream, symref };
      // A symbolic ref, such as `origin/HEAD`, is not a branch.
    }).filter(({ symref }) => symref === '');
    // Also of a branch that isn't listed: what it tracks isn't a branch to offer.
    const tracked = new Set(entries.map(({ upstream }) => upstream));
    const readable = entries.filter(({ ref }) => !ref.includes(UNDECODABLE));

    const local: LocalBranch[] = readable
      .filter(({ ref }) => ref.startsWith(HEADS))
      .map(({ ref, upstream }) => ({
        name: ref.slice(HEADS.length),
        // The whole name is cut, not shortened by git: a local branch can be called `origin/main`.
        upstream: upstream === '' ? null : upstream.replace(/^refs\/(remotes|heads)\//, '')
      }));
    if (noCommits && !local.some(({ name }) => name === FIRST_BRANCH)) {
      // No commit yet, so no ref.
      local.push({ name: FIRST_BRANCH, upstream: null });
    }

    const localNames = new Set(local.map(({ name }) => name));
    const remote: RemoteBranch[] = readable
      .filter(({ ref }) => ref.startsWith(ORIGIN) && !tracked.has(ref))
      .map(({ ref }) => ({ name: ref.slice(REMOTES.length), branch: ref.slice(ORIGIN.length) }))
      .filter(({ branch }) => !localNames.has(branch));

    return {
      current: head?.includes(UNDECODABLE) ? null : head,
      local: local.sort(byName),
      remote: remote.sort(byName)
    };
  }

  /** `HEAD` names a branch that has no commit yet, which is the only way it can't be resolved. */
  private async hasNoCommits(workingCopy: string): Promise<boolean> {
    const head = await this.local.run(workingCopy, [ 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}' ]);
    if (head.timedOut) {
      throw new GitOperationError('timeout', head.stderr);
    }
    if (head.exitCode !== 0 && head.exitCode !== 1) {
      throw new Error(`git rev-parse failed: ${head.stderr.trim()}`);
    }
    return head.exitCode === 1;
  }
}
