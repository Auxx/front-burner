# Security review

> Status: **In progress**. Authentication is reviewed (plan 145). Git and files
> (plan 146) and the browser and secrets (plan 147) follow.

The MVP's security review (`docs/product/mvp.md`, "Order of work", step 6). It
records a check of the code at one commit, not a rule: the rules are in
[security.md](../architecture/security.md), the requirements and NF-11, and this
page says whether the code keeps them.

Each section reads the code, not only the tests: a rule that has a test but can
be got around another way is a finding. Each row of a section's table names the
rule, where the code enforces it, the test that proves it, and the outcome:

- **Holds**: the code keeps the rule and a test proves it;
- **Fixed in this branch**: a finding, fixed with a test that failed before the
  fix;
- **Plan &lt;number&gt;**: a finding too large for the review's branch, with its
  own plan in Part F of the
  [step 6 index](../superpowers/plans/2026-11-16-00-roadmap-step-6.md);
- **Accepted**: a limit that the review records and the product accepts for the
  MVP, with the reason.

Paths are relative to `libs/server/`, except where they start with `apps/`.

## Authentication

Reviewed on 2026-11-20 at commit `dc256ab0`, in branch `review-auth` (plan 145):
everything that decides who a request comes from and what it may touch (A-7.2 to
A-7.5, NF-11.4, NF-11.5, REQ-AUTH-001, REQ-AUTH-003).

### Findings

Two findings, both fixed in this branch. Nothing needed a plan of Part F.

1. **A-7.5's test listed its routes.** The test that A-7.5 asks for did not
   exist as one test. Ownership was proven route by route, in each feature's
   end-to-end tests (`repositories`, `files`, `git`, `credentials`), each with
   its own hand-made list. A route added later without its own check would not
   have been noticed, and nothing checked that only the intended routes were
   public. **Fixed:** `@Public()` and `@AdminOnly()` now also mark their routes
   in the OpenAPI document (`x-front-burner-access`), which CI keeps equal to
   the code. `apps/server-e2e/src/access.e2e.spec.ts` reads every route from the
   document and checks that:
   - the public routes are exactly A-7.2's list;
   - every administrator route answers `403 forbidden` to a user who is not one,
     and every route under `/api/v1/admin/` is one;
   - every route with an ID answers another user's repository or saved
     credential exactly like a missing one (`404 not-found`). A route that needs
     a query or a body to pass validation must be given one in the test, or the
     test fails and names it.
2. **The refresh endpoint was limited per user, not per address.** LG-65 limits
   refresh by client IP. The endpoint had no rate limit group, so it fell under
   NF-11.4's general limits: 60 per address without an auth token, but 600 **per
   user** when the request carried a valid one. **Fixed:** a `refresh` group of
   60 per address per minute, NF-11.4's limit for unauthenticated requests
   _(plan's call)_. The risk was small, as a refresh token cannot be guessed
   (256 random bits), but the rule was not kept. Test: `login.e2e.spec.ts`,
   "LG-65: refreshes are limited per address, even with a valid auth token".

### A-7.2: the global guard and public routes

| Rule                                                                                         | Enforced by                                                                                                                                                                                                                                                                        | Test                                                                                                                  | Outcome                               |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Every route needs a login unless marked `@Public()`                                          | `AuthGuard`, a global guard (`feature/auth/src/sessions/auth.guard.ts`); `AuthMiddleware` sets `req.auth` only for a valid token of an active session                                                                                                                              | `auth.middleware.spec.ts`; every feature's end-to-end "needs a login" tests                                           | Holds                                 |
| Only login, refresh, logout, OIDC, onboarding and health are public                          | `@Public()` on `AuthController`, `OidcController`, `OnboardingController`, `HealthController`, `MetricsController`                                                                                                                                                                 | `access.e2e.spec.ts`, "A-7.2: only the routes meant to be public are"                                                 | Fixed in this branch (finding 1)      |
| The metrics are public but need their own token                                              | `MetricsController` compares `FRONT_BURNER_METRICS_TOKEN` in constant time; left out of the OpenAPI document, so outside the test above                                                                                                                                            | `api.e2e.spec.ts`, "metrics"                                                                                          | Holds                                 |
| The push channel serves only the caller's own events                                         | `EventsController` needs `req.auth`; `EventsHub.publish` sends to the user's streams only. A `?repository=` of another user's repository only marks the stream as viewing it, and the background fetch looks the repository up by user and ID (`FetchScheduler.enqueueIfUnlocked`) | `events-hub.spec.ts`, "delivers only to the user's streams"; `events.e2e.spec.ts`, "refuses a stream without a token" | Holds (read; not in the OpenAPI test) |
| Onboarding routes, though public, answer `404` without the setup token and once it is closed | `OnboardingGuard`, before validation                                                                                                                                                                                                                                               | `onboarding.e2e.spec.ts`, AC-AUTH-001.2, AC-AUTH-001.3, AC-AUTH-001.14                                                | Holds                                 |

### LG-24 to LG-38: auth tokens, refresh tokens and sessions

| Rule                                                                               | Enforced by                                                                                                                        | Test                                                                                                                                     | Outcome  |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| The auth token is HS256 only; `none` and other algorithms are refused              | `AuthTokenService.verify`: `jwtVerify` with `algorithms: ['HS256']`                                                                | `auth-token.service.spec.ts`, "refuses an auth token with another algorithm"                                                             | Holds    |
| The auth token holds the user, session and expiry only (LG-28)                     | `AuthTokenService.sign`: `sub`, `sid`, `jti`, `iat`, `exp`                                                                         | `auth-token.service.spec.ts`, "signs only sub, sid, jti, iat and exp"                                                                    | Holds    |
| An expired token, or one whose session is revoked or expired, gets `401`           | `AuthMiddleware` and `SessionService.isActive`, which also checks that the session is the token's user's                           | `login.e2e.spec.ts`, AC-AUTH-003.10, AC-AUTH-003.15                                                                                      | Holds    |
| The auth token never outlives its session                                          | `SessionService.issue` caps its expiry at the session's                                                                            | `session.service.spec.ts`, "never issues an auth token that outlives its session"                                                        | Holds    |
| A disabled user cannot log in or refresh (LG-24)                                   | `PasswordLoginService` (`user-disabled`), `OidcUserService.resolve`, `OidcLoginService.exchange`, `SessionService.refresh`         | `session.service.spec.ts`, "refuses the refresh of a disabled user"; `oidc.e2e.spec.ts`, AC-AUTH-003.8; `password-login.service.spec.ts` | Holds    |
| Disabling revokes every session (LG-25)                                            | `SessionService.revokeAllOf` exists; nothing in the MVP disables a user, as user management is not in it                           | `session.service.spec.ts`, "revokes every session of a user"                                                                             | Accepted |
| The refresh token is opaque, 256 random bits, stored as a hash (LG-29, LG-30)      | `SessionService.start`: `<session id>.<32 random bytes>`; only its SHA-256 is stored                                               | `session.service.spec.ts`, "starts a session and hashes the refresh token"                                                               | Holds    |
| Its cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, on the session path (LG-32) | `refresh-cookie.ts`, path `/api/v1/auth/session`                                                                                   | `login.e2e.spec.ts`, AC-AUTH-003.3                                                                                                       | Holds    |
| A cookie refresh or logout needs the custom header and no foreign `Origin` (LG-33) | `readRefreshToken`                                                                                                                 | `login.e2e.spec.ts`, AC-AUTH-003.13                                                                                                      | Holds    |
| Refreshing rotates the token and does not extend the session (LG-29, LG-35)        | `SessionService.refresh`; the update's condition on the old hash makes a concurrent refresh with the same token lose               | `session.service.spec.ts`, "rotates the refresh token", "does not extend the session on refresh"                                         | Holds    |
| A rotated token used again revokes the whole session (LG-36)                       | `SessionService.refresh`: a known session with a wrong hash is revoked, audited (`refresh-token-reused`) and logged                | `login.e2e.spec.ts`, AC-AUTH-003.12; `session.service.spec.ts`                                                                           | Holds    |
| Logout revokes the session at once, also with an expired auth token (LG-39)        | `SessionService.revokeByRefreshToken` and `revoke`, which also drop the cached session, close its push streams and its key unlocks | `login.e2e.spec.ts`, both AC-AUTH-003.15 tests; `session.service.spec.ts`, "closes the streams…", "announces…"                           | Holds    |
| Expired and revoked sessions are deleted (LG-38)                                   | `auth-housekeeping.ts`                                                                                                             | `auth-housekeeping.spec.ts`                                                                                                              | Holds    |

Accepted limits:

- **A refresh token with a known session ID and a wrong secret revokes the
  session.** The backend cannot tell such a token from a rotated one, so LG-36
  applies. The session ID is in the refresh token and in the auth token's `sid`,
  so only someone who already holds one of the session's tokens can do this, and
  all it does is log that session out.
- **The session cache keeps an entry for every session it has seen** until the
  process restarts, revoked ones excepted. Each entry is a few numbers, logins
  are rate-limited, and housekeeping deletes old sessions from the database,
  from which a missing entry is read again.

### REQ-AUTH-001: the setup token and onboarding

| Rule                                                                           | Enforced by                                                                                                                                                       | Test                                                                                     | Outcome |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------- |
| The setup token is compared in constant time                                   | `OnboardingGuard` with `constantTimeEquals`, which hashes both sides first, so lengths do not leak                                                                | `onboarding.guard.spec.ts`; `onboarding.e2e.spec.ts`, AC-AUTH-001.3                      | Holds   |
| Onboarding is disabled for good once completed                                 | `OnboardingGuard` answers `404` when the state is `completed`; `OnboardingService.setUpPassword` and `OidcUserService` complete it in one conditional transaction | `onboarding.e2e.spec.ts`, AC-AUTH-001.13 (two at once), AC-AUTH-001.14 (after a restart) | Holds   |
| With OIDC from the environment, only the first OIDC login completes onboarding | `OnboardingGuard` answers `404` to every change (AO-33)                                                                                                           | `onboarding.guard.spec.ts`                                                               | Holds   |
| The setup token routes share 10 per address per minute, also once completed    | `setup-token` group; the global throttler runs before the controller's `OnboardingGuard`, so a refused request counts                                             | `onboarding.e2e.spec.ts`, "the setup-token group is limited…", "the limit stays on…"     | Holds   |
| No secret in the log or the API (AO-38)                                        | the request log's redaction and `urlForLog`; the OIDC setup view has no secret                                                                                    | `onboarding.e2e.spec.ts`, "logs no secret", "logs the saved setup without the secret"    | Holds   |

### OIDC

| Rule                                                                                                     | Enforced by                                                                       | Test                                                                                                                                                                                           | Outcome |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `state`, `nonce` and PKCE (S256) on every login, each used once                                          | `OidcLoginService.start` and `complete`; `PendingLogins.take` forgets the login   | `oidc-login.service.spec.ts`, "starts with PKCE, state and nonce", "refuses a callback without the state cookie" (also a different one), "uses a pending login once", "reports a wrong nonce…" | Holds   |
| The ID token must come from the configured issuer, for this client                                       | `openid-client`'s `authorizationCodeGrant` against the discovered configuration   | `oidc-login.service.spec.ts`, "reports an ID token from another issuer or for another client as invalid-id-token" (added by this review)                                                       | Holds   |
| The issuer of a new setup must match its discovery document                                              | `OidcSetupService`                                                                | `oidc-setup.service.spec.ts`; `onboarding.e2e.spec.ts`, "refuses an issuer that differs…"                                                                                                      | Holds   |
| A verified email when required (LG-19, AO-27)                                                            | `OidcUserService.resolve`, before the required claim and before any user is found | `oidc.e2e.spec.ts`, AC-AUTH-001.9; `oidc-user.service.spec.ts`                                                                                                                                 | Holds   |
| Users are found by issuer and `sub`; an email links only an unlinked OIDC user and never a password user | `OidcUserService.findOrCreate`                                                    | `oidc-user.service.spec.ts`; `oidc.e2e.spec.ts`, AC-AUTH-003.8                                                                                                                                 | Holds   |
| Tokens never in a URL; the one-time code is bound to the browser, 60 s, once (LG-22)                     | `OneTimeCodes`, bound to the `state` cookie                                       | `oidc.e2e.spec.ts`, AC-AUTH-003.7; `oidc-login.service.spec.ts`, "refuses a code without the state…", "expires a code after 60 seconds", "uses a code once"                                    | Holds   |
| The callback's code and `state` are never logged                                                         | `urlForLog` drops the query from the request log and from redirect locations      | `request-url.spec.ts`; `logging.module.spec.ts`                                                                                                                                                | Holds   |

Accepted limit: **pending OIDC logins are kept in memory, at most 1,000.** `GET
/auth/oidc/start` has only the general limit of 60 per address per minute, so
someone with many addresses could push other people's pending logins out, and
those logins would fail with `state-mismatch`. They would only have to try
again; nothing is disclosed.

### A-7.3 to A-7.5: ownership and roles

| Rule                                                                                        | Enforced by                                                                                                                                                                                                 | Test                                                                                                                                  | Outcome                          |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| A repository or saved credential in a path is looked up by ID **and** user; otherwise `404` | Each service, by user and ID (for example `SavedCredentialsService.findOwned`, `GitJobsService.state`, which also matches the job's user), not by a guard as A-7.3 first said; security.md now records this | `access.e2e.spec.ts`, A-7.5, which finds every such route itself                                                                      | Fixed in this branch (finding 1) |
| A saved credential's ID in a body is the caller's                                           | `RequestCredentials.resolve` (`findOwned`), shared by adding a repository, the access check and replacing credentials                                                                                       | `add-repository.e2e.spec.ts`, AC-REPO-001.22; `credentials.e2e.spec.ts`, AC-REPO-001.22                                               | Holds                            |
| Administrator routes answer `403` to anyone else, after `401` (A-7.4)                       | `AdminOnlyGuard`, a global guard after `AuthGuard`, reading the role from the user's row                                                                                                                    | `access.e2e.spec.ts`, A-7.4, which finds every such route itself; `api.e2e.spec.ts`, "A-7.5: the endpoint is for administrators only" | Fixed in this branch (finding 1) |

### NF-11.4, NF-11.5 and `trust proxy`

| Rule                                                                            | Enforced by                                                                                                                                                                                                   | Test                                                                                                                                                                                  | Outcome                          |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 600 requests per user, 60 per address unauthenticated, `429` with `Retry-After` | `RateLimitModule`, `AppThrottlerGuard`                                                                                                                                                                        | `throttler.guard.spec.ts`                                                                                                                                                             | Holds                            |
| Login and OIDC: 10 per address, whoever is logged in (LG-65)                    | `login` and `oidc` groups, per address                                                                                                                                                                        | `login.e2e.spec.ts`, AC-AUTH-003.24; `throttler.guard.spec.ts`, "counts a group per address even for authenticated users"                                                             | Holds                            |
| Refresh: per address (LG-65)                                                    | `refresh` group, 60 per address                                                                                                                                                                               | `login.e2e.spec.ts`, "LG-65: refreshes are limited per address, even with a valid auth token"                                                                                         | Fixed in this branch (finding 2) |
| A refused login is audited as `rate-limited`                                    | `RateLimitAuditFilter`                                                                                                                                                                                        | `login.e2e.spec.ts`, AC-AUTH-003.24                                                                                                                                                   | Holds                            |
| At most 3 clones waiting or running per user                                    | the clone job type's per-user limit in the job runner (`clone.job.ts`, `job-types.ts`)                                                                                                                        | `clone-again.service.spec.ts`, "counts towards the clone limit"                                                                                                                       | Holds                            |
| JSON bodies at most 2 MB (NF-11.5)                                              | `app.useBodyParser('json', { limit: '2mb' })` in `apps/server/src/startup/start-server.ts`, with Nest's own parser off                                                                                        | `start-server.spec.ts`, "limits JSON bodies to 2 MB"; `api.e2e.spec.ts`, "refuses a JSON body over 2 MB with 413 payload-too-large"                                                   | Holds                            |
| A client cannot choose its own address (A-1.15)                                 | `trust proxy` is `FRONT_BURNER_TRUSTED_PROXIES` (default: loopback and private networks); a client that is not a trusted proxy cannot change `req.ip`, which both the rate limits and the login audit log use | `start-server.spec.ts`, "ignores X-Forwarded-For from an unrelated address when counting logins", "counts logins per forwarded address behind a trusted proxy" (added by this review) | Holds                            |

Accepted limit: **the default trusts every private address.** On a home network
where the container's port is reachable from other machines, any of them could
claim another address and get around the login limit. The compose example
publishes the port on `127.0.0.1` only, and the deployment guide tells the
operator to list only the reverse proxy's address when anything else on those
networks can reach the port.

### LG-66 and LG-41: the login audit log

| Rule                                                                             | Enforced by                                                                                                                                                                    | Test                                                                                                | Outcome |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------- |
| Every password login, every OIDC login and every refresh token reuse is recorded | `PasswordLoginService` (every outcome), `OidcLoginService` (every failure, before a user is known too, and every success), the `SESSION_REUSE_HANDLER`, `RateLimitAuditFilter` | `login.e2e.spec.ts`, AC-AUTH-003.5; `oidc-login.service.spec.ts`; `oidc.e2e.spec.ts`, AC-AUTH-003.8 | Holds   |
| No password, token, code or client secret in the audit log or the log            | `LoginAuditService` stores none; the request log redacts `Authorization`, `Cookie` and `Set-Cookie` and drops queries; emails go to the log at `debug` only                    | `login.e2e.spec.ts`, AC-AUTH-003.25; `logger-options.spec.ts`; `logging.module.spec.ts`             | Holds   |
