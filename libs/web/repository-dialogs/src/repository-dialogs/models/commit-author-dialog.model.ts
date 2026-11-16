import type { RepositoryCommitAuthor } from '@front-burner/shared-contracts';

/** What the commit author dialogs open with. */
export interface CommitAuthorDialogData {
  readonly repositoryId: number;
  /** The commit author that applies to the repository now (CA-6). */
  readonly current: RepositoryCommitAuthor;
  /**
   * Whether the dialog edits this repository's override only, without the
   * choice of the default, as for **Use a different author for this
   * repository** on the settings page (RM-15).
   */
  readonly overrideOnly?: boolean;
}
