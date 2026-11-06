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
- `ChangeCommitAuthorDialog`: **Change** on the commit form, as the default or
  for this repository.
- `ConfirmCommitAuthorDialog`: the question before a user's first commit.
- `CredentialsSectionComponent` (`credentials-form/`): the **Credentials**
  choices of a remote URL's protocol, reset when the protocol changes (AR-11,
  AR-16), with HTTPS (AR-19 to AR-22) and SSH (AR-23 to AR-31) options. Its
  model is `CredentialsModel`, checked by `credentialsSchema`;
  `toRepositoryCredentials` makes the API's value.
- `SessionKeysService`: the key generated and the keys unlocked on one visit;
  provided by the page or dialog that shows the section.
- `SubmitFailuresService`: the backend's field failures of the last submit,
  shown on their fields until the inputs change; optional, provided by the page
  or dialog. `shownError` and `fieldErrorKey` give a field's text; the
  credentials' texts are under `web-repository-dialogs.errors.credentials`.
- `TrustHostDialog`: "Do you trust this server?" for an unknown SSH host
  (AR-32).

## Running unit tests

Run `nx test web-repository-dialogs` to execute the unit tests.
