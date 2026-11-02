# web-repository-dialogs

What several web features share about a repository's git setup (A-2.4).

- `CommitAuthorFormComponent`: the name and email of a commit author, with
  CA-11's explanation and the backend's field errors next to the fields (CA-10).
- `CommitAuthorSummaryComponent`: the same author, read-only, under the same
  labels.
- `commitAuthorForm`: builds the form's signal form with the rules of CA-10, and
  makes it read-only while it is submitted.
- `CommitAuthorRefusals`: the backend's field errors of the last request, kept
  until their field changes, and focusing the first field with an error.

## Running unit tests

Run `nx test web-repository-dialogs` to execute the unit tests.
