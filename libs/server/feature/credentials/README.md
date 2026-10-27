# server-feature-credentials

A user's saved credentials, known hosts and key unlocks (REQ-REPO-001, AR-17 to
AR-32).

- `SavedCredentialsService`: saves HTTPS credentials and pasted keys inside a
  caller's transaction, generates keys, lists them without secrets and resolves
  them for git (`key-locked`, `credentials-missing`). Every lookup is by ID and
  user; another user's ID is a `404` (AR-56).
- `KnownHostsService`: the user's trusted host keys, as `known_hosts` lines;
  refuses to replace a key `ssh` would report as changed (AR-32).
- `KeyUnlockStore`: passphrase-protected SSH keys unlocked per session, in
  memory only, with the `FRONT_BURNER_KEY_UNLOCK_IDLE` idle timer (AR-31,
  A-5.5). Revoking a session drops its unlocks through `SessionLifecycle`.

## Running unit tests

Run `nx test server-feature-credentials` to execute the unit tests via
[Vitest](https://vitest.dev/).
