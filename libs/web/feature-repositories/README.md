# web-feature-repositories

The repository pages of the web client, loaded under `/repositories` (A-2.2).

- `AddRepositoryPage` (`/repositories/new`): the Add repository form of
  REQ-REPO-001, one Signal Forms model (`AddRepositoryForm`) split into a
  component per section.
- `RemoteSectionComponent`: **Remote URL** and **Repository name**, with the
  duplicate-remote warning and the name filled from the URL (AR-8 to AR-15).
- `CredentialsSectionComponent`: the options of the URL's protocol, reset when
  the protocol changes (AR-11, AR-16); `HttpsCredentialsComponent` for HTTPS
  (AR-19 to AR-22).

## Running unit tests

Run `nx test web-feature-repositories` to execute the unit tests.
