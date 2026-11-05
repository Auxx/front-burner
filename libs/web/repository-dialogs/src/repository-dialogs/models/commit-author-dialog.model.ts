import type { RepositoryCommitAuthor } from '@front-burner/shared-contracts';

/** What the commit author dialogs open with. */
export interface CommitAuthorDialogData {
  readonly repositoryId: number;
  /** The commit author that applies to the repository now (CA-6). */
  readonly current: RepositoryCommitAuthor;
}
