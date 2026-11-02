import { signal } from '@angular/core';
import { type FieldTree, form, validateStandardSchema } from '@angular/forms/signals';
import { type CommitAuthor, CommitAuthorSchema } from '@front-burner/shared-contracts';

/**
 * The signal form of a commit author, with the rules of CA-10. Builds a `form`,
 * so call it in an injection context.
 */
export function commitAuthorForm(initial: CommitAuthor): FieldTree<CommitAuthor> {
  return form(signal(initial), path => {
    validateStandardSchema(path, CommitAuthorSchema);
  });
}
