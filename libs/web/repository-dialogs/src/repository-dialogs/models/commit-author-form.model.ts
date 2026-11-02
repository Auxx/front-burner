import { signal } from '@angular/core';
import { type FieldTree, form, readonly, validateStandardSchema } from '@angular/forms/signals';
import { type CommitAuthor, CommitAuthorSchema } from '@front-burner/shared-contracts';

/**
 * The signal form of a commit author, with the rules of CA-10. Its fields are
 * read-only while it is submitted, so that what the user sees is what is sent.
 * Builds a `form`, so call it in an injection context.
 */
export function commitAuthorForm(initial: CommitAuthor): FieldTree<CommitAuthor> {
  return form(signal(initial), path => {
    validateStandardSchema(path, CommitAuthorSchema);
    readonly(path, ({ state }) => state.submitting());
  });
}
