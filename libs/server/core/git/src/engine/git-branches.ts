import { Injectable } from '@nestjs/common';
import { GitOperationError } from './git-errors';
import { FIRST_BRANCH } from './git-status';
import { LocalGit, UNDECODABLE } from './local-git';

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

const byName = (a: { name: string; }, b: { name: string; }) => {
  if (a.name === b.name) {
    return 0;
  }
  return a.name < b.name ? -1 : 1;
};

/**
 * The branches of a working copy, as of the last fetch. Takes no locks: it only
 * reads refs, so it runs outside the working-tree lock (A-5.3).
 */
@Injectable()
export class GitBranches {
  constructor(private readonly local: LocalGit) {}

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
