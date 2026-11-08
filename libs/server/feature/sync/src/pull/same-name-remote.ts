import type { GitMerge, WorkingCopyStatus } from '@front-burner/server-core-git';

/**
 * The branch is unpublished and has commits, and `origin` has a branch of its
 * name as of the last fetch, which **Pull** then merges and makes the upstream
 * (GA-8, GA-30). False otherwise, without asking git.
 */
export async function sameNameRemote(merge: GitMerge, root: string, status: WorkingCopyStatus): Promise<boolean> {
  return status.branch !== null && status.upstream === null && !status.noCommits
    && await merge.hasRemoteBranch(root, status.branch);
}
