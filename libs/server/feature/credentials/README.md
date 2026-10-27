# server-feature-credentials

A user's saved credentials, known hosts and key unlocks (REQ-REPO-001, AR-17 to
AR-32).

- `KeyUnlockStore`: passphrase-protected SSH keys unlocked per session, in
  memory only, with the `FRONT_BURNER_KEY_UNLOCK_IDLE` idle timer (AR-31,
  A-5.5). Revoking a session drops its unlocks through `SessionLifecycle`.

## Running unit tests

Run `nx test server-feature-credentials` to execute the unit tests via
[Vitest](https://vitest.dev/).
