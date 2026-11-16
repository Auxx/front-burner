# web-feature-repositories

The repository pages of the web client, loaded under `/repositories` (A-2.2).

- `RepositoriesPage` (`/repositories`): the repository management page of
  REQ-REPO-003. Lists all of the user's repositories in the API's order, filters
  them by name and remote as the user types, without a request, and follows
  clones through `web-shell`'s `followRepositoryList` (RM-4, RM-5, RM-7).
  Without repositories it shows the full guide instead.
- `RepositoryListEntryComponent`: one entry: the name, linking to the
  repository's settings page, **Ready** or another status and the warnings, the
  remote, what went wrong or the clone's progress, "Last accessed", and **Open**
  for an openable repository.
- `RepositorySettingsPage` (`/repositories/<id>/settings`): the repository
  settings page of RM-9: the breadcrumbs "Repositories › _name_ › Settings"
  (NV-14), whose name links to the repository screen, or to this page while the
  repository cannot be opened; the name, status and warnings, remote and
  **Open**; then its sections in the order of RM-9. A missing, malformed or
  another user's ID is Page not found (RM-1). It titles itself "Settings ·
  _name_ · Front Burner" (NV-13).
- `RepositorySettingsStore`: the page's repository details (`GET
  /repositories/:id/details`), provided by the page and read by its sections. It
  reads them again on the repository's `repository.status` and
  `repository.warning`, on `key.locked` and `key.unlocked`, and after a
  reconnect; only the latest answer counts, and a reload that fails keeps them.
  Its clone's `job.progress` is patched in place.
- `CloneStatusComponent`: the **Status** section, only while cloning or in
  error: the clone's progress, or the error's label and **Details** with git's
  error as plain text and the request ID with **Copy** (RM-7, RM-10).
- `CredentialsInUseComponent`: the **Credentials** section, the credentials in
  use as a key-value list, never their secret, and **Change credentials** in
  every status, which opens `web-repository-dialogs`' repository credentials
  dialog (RM-14, RC-11). Saving there is the end: the section and the store read
  again. Its `change()` resolves to `true` once the dialog saved.
- `CloneDetailsComponent`: the **Clone details** section, a key-value list of
  the clone mode, the git control level and when the repository was added
  (RM-16).
- `AddRepositoryPage` (`/repositories/new`): the Add repository form of
  REQ-REPO-001, one Signal Forms model (`AddRepositoryForm`) split into a
  component per section.
- `RemoteSectionComponent`: **Remote URL** and **Repository name**, with the
  duplicate-remote warning and the name filled from the URL (AR-8 to AR-15).
- The **Credentials** section, its trust dialog and the services behind them
  come from `web-repository-dialogs`; the page provides `SessionKeysService` and
  `SubmitFailuresService`.
- `CloneSectionComponent` and `LevelSectionComponent`: clone mode, branch and
  git control level (AR-33 to AR-40).
- `BranchListService`: the branch list's access check, debounced, with stale
  answers dropped (AR-35); provided by the page.
- `failureTexts` (`utils/add-repository-errors.ts`): the one mapping from the
  API's failures to AR-42's texts and where they are shown. A key is relative to
  the `errors` texts of the section that shows the field: the credentials'
  texts, and the codes they have texts for, are in `web-repository-dialogs`
  (`web-repository-dialogs.errors.credentials.*`); the other fields' are here
  (`web-feature-repositories.errors.*`).
- `unsavedChangesGuard`: asks before leaving a changed form (AR-48); the page
  also asks on reload or closing the tab.

## Running unit tests

Run `nx test web-feature-repositories` to execute the unit tests.
