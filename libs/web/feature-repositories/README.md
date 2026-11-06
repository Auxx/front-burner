# web-feature-repositories

The repository pages of the web client, loaded under `/repositories` (A-2.2).

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
