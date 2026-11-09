import { Injectable } from '@nestjs/common';
import { GitOperationError } from './git-errors';
import { LocalGit } from './local-git';

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
  /** `null` on a detached `HEAD`. */
  current: string | null;
  /** Sorted by name, comparing code units, so that the order is the same on every device. */
  local: LocalBranch[];
  /** The branches of `origin` that no local branch has the name of or tracks (GA-36), sorted as `local`. */
  remote: RemoteBranch[];
}

const HEADS = 'refs/heads/';
const REMOTES = 'refs/remotes/';
const ORIGIN = `${REMOTES}origin/`;

/** The branch that the first commit makes, whatever `HEAD` names (GA-42). */
const FIRST_BRANCH = 'main';

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

  /** The local branches, and the remote ones to offer next to them (GA-36, GA-41, GA-42). */
  async list(workingCopy: string): Promise<BranchList> {
    const [ refs, head ] = await Promise.all([
      this.local.checked(workingCopy, [
        'for-each-ref',
        '--format=%(refname)%00%(upstream)%00%(symref)',
        'refs/heads',
        'refs/remotes/origin'
      ]),
      this.headRef(workingCopy)
    ]);
    const entries = refs.split('\n').filter(line => line !== '').map(line => {
      const [ ref = '', upstream = '', symref = '' ] = line.split('\0');
      return { ref, upstream, symref };
    });

    const local: LocalBranch[] = entries
      .filter(({ ref }) => ref.startsWith(HEADS))
      .map(({ ref, upstream }) => ({
        name: ref.slice(HEADS.length),
        // Git does not shorten it: a local branch named `origin/main` would make the short name mean that branch.
        upstream: upstream === '' ? null : upstream.replace(/^refs\/(remotes|heads)\//, '')
      }));

    const current = this.currentBranch(head, local);
    if (current !== null && !local.some(({ name }) => name === current)) {
      // No commit yet, so no ref: the branch exists only as what HEAD names.
      local.push({ name: current, upstream: null });
    }

    const localNames = new Set(local.map(({ name }) => name));
    const tracked = new Set(entries.map(({ upstream }) => upstream));
    const remote: RemoteBranch[] = entries
      // A symbolic ref, such as `origin/HEAD`, is not a branch.
      .filter(({ ref, symref }) => ref.startsWith(ORIGIN) && symref === '' && !tracked.has(ref))
      .map(({ ref }) => ({ name: ref.slice(REMOTES.length), branch: ref.slice(ORIGIN.length) }))
      .filter(({ branch }) => !localNames.has(branch));

    return { current, local: local.sort(byName), remote: remote.sort(byName) };
  }

  /** What `HEAD` names, such as `refs/heads/main`, or `null` when it is detached. */
  private async headRef(workingCopy: string): Promise<string | null> {
    const head = await this.local.run(workingCopy, [ 'symbolic-ref', '--quiet', 'HEAD' ]);
    if (head.timedOut) {
      throw new GitOperationError('timeout', head.stderr);
    }
    return head.exitCode === 0 ? head.stdout.trim() : null;
  }

  private currentBranch(head: string | null, local: LocalBranch[]): string | null {
    if (head === null || !head.startsWith(HEADS)) {
      return null;
    }
    const name = head.slice(HEADS.length);
    return local.some(branch => branch.name === name) ? name : FIRST_BRANCH;
  }
}
