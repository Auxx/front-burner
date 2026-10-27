# web-feature-repositories

The repository pages of the web client, loaded under `/repositories` (A-2.2).

- `AddRepositoryPage` (`/repositories/new`): the Add repository form of
  REQ-REPO-001, one Signal Forms model (`AddRepositoryForm`) split into a
  component per section.
- `RemoteSectionComponent`: **Remote URL** and **Repository name**, with the
  duplicate-remote warning and the name filled from the URL (AR-8 to AR-15).
- `CredentialsSectionComponent`: the options of the URL's protocol, reset when
  the protocol changes (AR-11, AR-16); `HttpsCredentialsComponent` for HTTPS
  (AR-19 to AR-22); `SshCredentialsComponent` and `GeneratedKeyComponent` for
  SSH (AR-23 to AR-31).
- `CloneSectionComponent` and `LevelSectionComponent`: clone mode, branch and
  git control level (AR-33 to AR-40).
- `BranchListService`: the branch list's access check, debounced, with stale
  answers dropped (AR-35); provided by the page.
- `failureTexts` (`utils/add-repository-errors.ts`): the one mapping from the
  API's failures to AR-42's texts and where they are shown.
- `TrustHostDialog`: "Do you trust this server?" for an unknown SSH host
  (AR-32); **Trust** saves it and repeats the request.
- `unsavedChangesGuard`: asks before leaving a changed form (AR-48); the page
  also asks on reload or closing the tab.
- `SessionKeysService`: the key generated and the keys unlocked on this visit,
  provided by the page.

## Running unit tests

Run `nx test web-feature-repositories` to execute the unit tests.
