# server-feature-auth

Authentication of the backend (A-2). So far: administrator onboarding with
username + password (REQ-AUTH-001) and password hashing with Argon2id
(REQ-AUTH-002, PP-12).

- `OnboardingModule`: `GET /api/v1/onboarding`, `POST
  /api/v1/onboarding/setup-token/check` and `POST
  /api/v1/onboarding/password-setup`. `OnboardingGuard` runs before validation,
  so that a closed onboarding or a wrong setup token answers exactly like an
  unknown route (AO-3, AO-10).
- `OnboardingStateService`: works out the onboarding state on startup (AO-1).
- `PasswordHasher`: Argon2id of the NFC-normalised password (PP-1, PP-12).

## Running unit tests

Run `nx test server-feature-auth` to execute the unit tests via
[Vitest](https://vitest.dev/).
