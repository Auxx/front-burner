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
  Its clone's `job.progress` is patched in place, and `cloning()` shows the
  answer to a retried clone at once, over the **Error** it replaces only, and
  reads the details again.
- `RepositoryWarningsComponent`: the **Warnings** under the page's header, one
  line per warning with its fix (RM-8, RC-6): **Fix credentials** and **Use
  other credentials** through `CredentialsInUseComponent.change()`, **Review the
  new key** with the new key from the details' `remoteProblems` (RC-21), and
  **Unlock** (RC-16), the last two through `web-repository-dialogs`'
  `KeyDialogsService`. After every fix but **Use other credentials** a fetch
  runs, and a warning that the last push left says that a push clears it. One
  fix runs at a time.
- `CloneStatusComponent`: the **Status** section, only while cloning or in
  error: the clone's progress, or the error's label and **Details** with git's
  error as plain text and the request ID with **Copy** (RM-7, RM-10). In error,
  **Retry clone** after a clone, or **Clone again**, after a warning, for a
  working copy that is missing or damaged (RM-11, RM-12): one request per press,
  a locked key unlocked first with `web-repository-dialogs`' `KeyDialogsService`
  (RC-16), and **Cloning** shown at once through the store. Cancelling either
  dialog changes nothing; any other refusal, such as a limit (RM-13), is shown
  above the button.
- `CredentialsInUseComponent`: the **Credentials** section, the credentials in
  use as a key-value list, never their secret, and **Change credentials** in
  every status, which opens `web-repository-dialogs`' repository credentials
  dialog (RM-14, RC-11). Saving there is the end: the section and the store read
  again. Its `change()` resolves to `true` once the dialog saved; while a dialog
  is open, a second call resolves as that one does. The section also reads the
  credentials again on the repository's `repository.status` and
  `repository.warning` and after a reconnect, and says when their secret was
  deleted by an encryption key reset (NF-8.6).
- `RepositoryCommitAuthorComponent`: the **Commit author** section, "Commits use
  _Name &lt;email&gt;_" and whether that is the default or an override (RM-15,
  CA-9), in every status. **Use a different author for this repository** opens
  `web-repository-dialogs`' `ChangeCommitAuthorDialog` for the override only;
  **Use my default** removes the override without asking. Its `change()`
  resolves to `true` once the dialog saved, as `CredentialsInUseComponent`'s
  does, and a cancelled dialog reads the author again. It reads the author again
  on `commit-author.changed` and after a reconnect, so a default changed on the
  Preferences page shows here.
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
