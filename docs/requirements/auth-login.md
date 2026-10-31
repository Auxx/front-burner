# REQ-AUTH-003: Login

> Status: **Accepted**

## Summary

A user who is already set up signs in to an instance on the login page, with one
of the two login methods:

- **username + password**: they enter their email and password;
- **OIDC**: they sign in through the OIDC provider configured on the instance.

Both methods end the same way: the backend starts a session and gives the client
an auth token and a refresh token. The web client keeps the auth token in
`localStorage` and receives the refresh token in an `HttpOnly` cookie. It uses
the auth token for API requests and renews it with the refresh token when it
expires.

A password user who forgot their password can reset it with a reset code sent by
email. Disabled users cannot log in or reset their password. Every login attempt
is recorded in the login audit log.

This requirement assumes that the instance and the user are fully set up.
Administrator onboarding is covered by [REQ-AUTH-001](auth-onboarding.md).
Onboarding of invited users is covered by a separate requirement.

## Context

- An instance can have password users and OIDC users at the same time. The login
  method belongs to the user, not to the instance, and the login page cannot
  know who the visitor is before they sign in. The login page therefore shows
  every login method that is available on the instance.
- The username is always the user's email address. Login and password reset must
  not reveal whether an email has an account, which login method it uses, or
  whether it is disabled (enumeration attacks). Users only ever see generic
  errors; the detailed reason goes to the login audit log and the backend log,
  where administrators and operators can find it.
- Auth tokens are short-lived so that a stolen token is useful only for a short
  time. Sessions are stored in the database so that they can be revoked, for
  example when a password is reset, a user is disabled or the user logs out.
- The refresh token lives much longer than the auth token. In the web client it
  is kept in an `HttpOnly` cookie, so that a script injected into the page (XSS)
  cannot read it.
- The API must not assume that the web client is its only consumer (vision goal
  12). Native clients cannot rely on browser cookies, so they can ask for the
  refresh token in the response body instead.
- The web client and the API are served from the same origin, so the refresh
  token cookie can be `SameSite=Strict`.

## Terms

**Session**
: One login of one user on one client. Stored by the backend. A session is
  _active_ until it expires, the user logs out, or it is revoked.

**Auth token**
: A short-lived signed JWT that a client sends with every API request to prove
  who the user is. Belongs to one session.

**Refresh token**
: A long-lived random secret that a client exchanges for a new auth token (and a
  new refresh token) when the auth token expires. Belongs to one session. In the
  web client it is kept in an `HttpOnly` cookie.

**Reset code**
: A short one-time code that the backend emails to a password user so that they
  can set a new password.

**Disabled user**
: A user whose account an administrator has disabled. The account and its data
  are kept, but the user cannot log in or reset their password until an
  administrator enables it again.

**Login audit log**
: A database table in which the backend records every login attempt, with its
  outcome and the detailed reason for a failure.

## Requirements

### General

- **LG-1** The login page, the Forgot password page and the Confirm password
  reset page are public: they can be reached without being logged in.
- **LG-2** While administrator onboarding sends routes elsewhere
  ([REQ-AUTH-001](auth-onboarding.md), AO-2 and AO-33), those rules take
  precedence over this requirement. While the onboarding state is
  `oidc-pending`, OIDC login follows AO-26 to AO-29, which show the operator the
  detailed reason for a failure.
- **LG-3** A user who is already logged in and opens the login page, the Forgot
  password page or the Confirm password reset page is sent to the home page.
- **LG-4** When a visitor who is not logged in opens a page that needs a login,
  the web client sends them to the login page and remembers the page they asked
  for. After a successful login it sends them back to that page. Only paths
  inside the web client are accepted as return targets, so the login page cannot
  be used as an open redirect.
- **LG-5** The backend enforces every rule in this requirement. Hiding pages or
  fields in the web client is not enough (vision goal 12).
- **LG-6** All pages in this requirement are fully usable in desktop and mobile
  browsers.

### Login page

- **LG-7** The login page shows the login methods that are available on the
  instance:
  - the **username + password** form is always shown;
  - the **Log in with OIDC** button is shown when OIDC is configured. If OIDC is
    configured but the provider cannot be reached (AO-32), the button is
    replaced by a message that OIDC login is not available right now.
- **LG-8** The API exposes, without authentication, which login methods are
  available and whether password reset is available (LG-48). It does not expose
  any other data, such as OIDC settings.
- **LG-9** The login page can show a one-off message passed to it by another
  page, for example after a password reset (LG-56), after a logout (LG-39), or
  when a session has expired (LG-40). It is shown until the user's first login
  attempt on that page.

### Username + password login

- **LG-10** The form has:
  - **Email** (required, must be a valid email);
  - **Password** (required);
  - a **Log in** button;
  - a **Forgot password?** link to the Forgot password page (see LG-48).
- **LG-11** The web client checks only that both fields are filled in and that
  the email is valid. It does **not** check the password policy at login
  ([REQ-AUTH-002](auth-password-policy.md), Scope). The **Log in** button is
  disabled while the form is invalid and while the request is in progress.
- **LG-12** The backend compares the email case-insensitively, after trimming
  leading and trailing spaces. The password is never trimmed (PP-2) and is
  normalized as in PP-1 before it is compared with the stored hash.
- **LG-13** The login succeeds only if all of these are true:
  - a user with that email exists;
  - the user is a password user;
  - the user has finished onboarding (has set a password);
  - the password matches the stored hash;
  - the user is not disabled (LG-24).
- **LG-14** If the login fails for any of the reasons in LG-13, the API responds
  with `401 Unauthorized` and the same generic error, "Wrong username or
  password". The response body, status code and headers are identical for every
  reason. The web client shows the error above the form and clears the password
  field. The detailed reason is recorded as in LG-41.
- **LG-15** The response time does not reveal why the login failed. The backend
  always runs the password hash check, also for a disabled user, and when there
  is no password hash to check against it runs a check of the same cost against
  a dummy hash.
- **LG-16** When the login succeeds, the backend starts a session as in LG-27.

### OIDC login

- **LG-17** The **Log in with OIDC** button starts the OpenID Connect
  authorization code flow with PKCE, using the OIDC settings from system
  settings or environment variables ([REQ-AUTH-001](auth-onboarding.md)). The
  backend uses `state` and `nonce` values and checks them on return.
- **LG-18** When the provider sends the user back, the backend exchanges the
  code, validates the ID token (signature, issuer, audience, expiry, nonce), and
  finds the user:
  - by the provider identity (issuer + `sub`), if a user is already linked to
    it;
  - otherwise by email (case-insensitive), if an administrator added an OIDC
    user with that email and it is not linked yet. The backend links the user to
    the provider identity;
  - otherwise, if automatic registration is enabled, the backend creates a new
    OIDC user with that email, linked to the provider identity.
- **LG-19** When **Require verified email** is on (AO-21), the login is refused
  unless the provider says the email is verified.
- **LG-20** The OIDC login fails if:
  - the user cancels at the provider or the provider returns an error;
  - the provider cannot be reached, or the code exchange fails;
  - `state` does not match, or the ID token is invalid;
  - the email is not verified (LG-19);
  - no user is found and automatic registration is disabled;
  - the email belongs to a password user;
  - the user is disabled (LG-24).
- **LG-21** When the OIDC login fails, for any of the reasons in LG-20, the web
  client shows the login page with the same generic error, "OIDC login failed".
  The detailed reason, including any error code and description returned by the
  provider, is recorded as in LG-41 and never shown to the user.
- **LG-22** When the OIDC login succeeds, the backend starts a session as in
  LG-27. Tokens are never put in a URL. The backend sends the user back to the
  web client with a one-time code that is valid for at most 60 seconds, and the
  web client exchanges that code for the tokens through the API.
- **LG-23** After an OIDC login, the tokens are handled exactly as after a
  username + password login.

### Disabled users

- **LG-24** The backend checks whether the user is disabled on every login, with
  either login method, and on every refresh (LG-35). A disabled user's login
  fails with the generic error for its login method (LG-14 or LG-21).
- **LG-25** When an administrator disables a user, the backend revokes every
  session of that user. Enabling the user again does not bring those sessions
  back; the user has to log in again.
- **LG-26** A disabled user gets no reset code (LG-51), and cannot use a reset
  code that was sent before they were disabled (LG-58).

### Sessions and tokens

- **LG-27** When a login succeeds, the backend:
  1. creates a session for the user;
  2. issues an auth token and a refresh token for that session;
  3. returns the auth token and the expiry times of both tokens in the response
     body, and the refresh token as described in LG-31.
- **LG-28** The auth token:
  - is a JWT signed with HS256 using the secret in `FRONT_BURNER_JWT_SECRET`;
  - contains the user ID, the session ID and the expiry time, and no other
    personal data;
  - expires after `FRONT_BURNER_AUTH_TOKEN_TTL` (default 15 minutes);
  - is sent by clients in the `Authorization: Bearer` header.
- **LG-29** The refresh token:
  - is an opaque random value of at least 256 bits, not a JWT;
  - expires after `FRONT_BURNER_REFRESH_TOKEN_TTL` (default 30 days) from the
    start of the session. Refreshing does not extend this limit.
- **LG-30** The backend stores each session in the database with: user, time
  created, time last used, expiry, a hash of the current refresh token and the
  ID of the current auth token. Tokens are never stored in plain text.
- **LG-31** A client chooses how it receives the refresh token when it logs in
  (the login request and the OIDC code exchange in LG-22):
  - **cookie**: the refresh token is set in a cookie (LG-32) and never appears
    in the response body. The web client always uses this;
  - **body**: the refresh token is returned in the response body. Meant for
    native clients.

  The refresh endpoint (LG-35) answers in the same way the session was started.
  A refresh request that sends the token both in a cookie and in the body is
  refused.
- **LG-32** The refresh token cookie is `HttpOnly`, `Secure`, `SameSite=Strict`,
  and its path is limited to the authentication endpoints that need it (refresh
  and logout), so it is not sent with any other request. It expires together
  with the session. The web client must therefore be served over HTTPS; browsers
  allow `Secure` cookies on `localhost` for development. Over plain HTTP from
  any other address, users can log in but are not kept logged in once the auth
  token expires. The [deployment guide](../wiki/deployment.md) explains this to
  operators.
- **LG-33** When the refresh or logout endpoint reads the refresh token from the
  cookie, it also requires a custom request header that browsers do not send on
  cross-site requests without CORS permission, and refuses the request if the
  `Origin` header is present and is not the instance's origin. This protects
  against cross-site request forgery.
- **LG-34** On every authenticated request, the backend checks the auth token's
  signature and expiry and that its session is still active. A request with a
  missing, invalid or expired auth token, or one whose session is no longer
  active, gets `401 Unauthorized`. The response says whether the auth token
  expired, so clients know when refreshing can help.
- **LG-35** The refresh endpoint takes a refresh token and, if its session is
  active, the token matches and the user is not disabled, returns a new auth
  token and a new refresh token. The old refresh token stops working (rotation).
- **LG-36** If a refresh token that was already rotated is used again, the
  backend treats it as stolen and revokes the whole session.
- **LG-37** A session is revoked, and all its tokens stop working immediately,
  when:
  - the user logs out (LG-39);
  - the user is disabled (LG-25);
  - the user's password is reset (LG-57);
  - a rotated refresh token is reused (LG-36).
- **LG-38** Expired and revoked sessions are deleted from the database
  regularly.

### Logout

- **LG-39** Every page that needs a login offers **Log out**. Logging out sends
  the refresh token to the logout endpoint, which revokes its session and, for a
  cookie session, clears the cookie. This works even if the auth token has
  already expired. The web client then removes the auth token and shows the
  login page with the message "You have been logged out". If the backend cannot
  be reached, the web client still removes the auth token.

### Token handling in the web client

- **LG-40** The web client:
  - stores the auth token and the expiry times of both tokens in `localStorage`.
    It never sees the refresh token, which stays in the cookie;
  - adds the auth token to every API request;
  - when a request fails because the auth token expired, refreshes it (LG-35)
    and retries the failed request **once** with the new auth token;
  - runs at most one refresh at a time across all its browser tabs, for example
    with the Web Locks API, because two refreshes at the same time would trigger
    reuse detection (LG-36). A tab that waited for the lock first checks whether
    another tab has already stored a new auth token, and uses it instead of
    refreshing again;
  - if the refresh fails, removes the auth token, sends the user to the login
    page with the message "Your session has expired. Please log in again", and
    remembers the current page as in LG-4.

### Login audit log

- **LG-41** The backend records in the login audit log:
  - every username + password login attempt;
  - every OIDC login attempt, including failures before a user is known (for
    example a provider error or a `state` mismatch);
  - every refresh token reuse (LG-36).
- **LG-42** Each entry has:
  - time;
  - login method (`password` or `oidc`);
  - outcome (`success` or `failure`);
  - reason code (LG-43);
  - the email that was entered, or the email from the ID token, if any;
  - the user ID, if a user was found;
  - for OIDC: the issuer, the `sub` if known, and the error code and description
    returned by the provider, if any;
  - client IP address and user agent;
  - the session ID, for a successful login or a refresh token reuse.
- **LG-43** The reason codes are:

| Reason code               | Method   | Meaning                                                     |
| ------------------------- | -------- | ----------------------------------------------------------- |
| `success`                 | both     | The login succeeded.                                        |
| `unknown-email`           | password | No user with that email.                                    |
| `wrong-password`          | password | The password does not match.                                |
| `not-password-user`       | password | The email belongs to an OIDC user.                          |
| `onboarding-not-finished` | password | The user has not set a password yet.                        |
| `user-disabled`           | both     | The user is disabled.                                       |
| `rate-limited`            | both     | The request was refused by rate limiting (LG-65).           |
| `provider-error`          | oidc     | The provider returned an error, or the user cancelled.      |
| `provider-unreachable`    | oidc     | The provider could not be reached.                          |
| `code-exchange-failed`    | oidc     | The code could not be exchanged for tokens.                 |
| `state-mismatch`          | oidc     | `state` is missing or does not match.                       |
| `invalid-id-token`        | oidc     | The ID token failed validation.                             |
| `email-not-verified`      | oidc     | The email is not verified (LG-19).                          |
| `registration-disabled`   | oidc     | No user found and automatic registration is disabled.       |
| `password-user`           | oidc     | The email belongs to a password user.                       |
| `admin-email-mismatch`    | oidc     | Onboarding is pending and the email does not match (AO-27). |
| `refresh-token-reused`    | both     | A rotated refresh token was used again (LG-36).             |

- **LG-44** The login audit log never contains passwords, tokens, codes or
  client secrets.
- **LG-45** Entries older than `FRONT_BURNER_LOGIN_AUDIT_RETENTION` (default 90
  days) are deleted regularly.
- **LG-46** If an entry cannot be written, the login still proceeds, and the
  backend logs the error together with the entry.
- **LG-47** Every failed login is also written to the backend log, with its
  reason code and no secrets, so that operators can find OIDC problems without
  access to the database.

### Forgot password page

- **LG-48** Password reset needs outgoing mail. When SMTP is not configured in
  system settings, the **Forgot password?** link is hidden, and the Forgot
  password page says that password reset is not available and that the user
  should contact an administrator.
- **LG-49** The Forgot password page explains that a reset code will be sent to
  the email address the user enters, if it has an account. It has:
  - **Email** (required, must be a valid email);
  - a **Send code** button;
  - a link back to the login page.
- **LG-50** The API always responds with success, whether or not a code is sent,
  and responds in the same time in every case (the email is sent in the
  background).
- **LG-51** The backend sends a reset code only to a password user who has
  finished onboarding and is not disabled. For any other email, including OIDC
  users, invited users who have not set a password yet and disabled users,
  nothing is sent.
- **LG-52** The reset code:
  - has 6 characters, chosen from the uppercase Latin letters `A`–`Z` and the
    digits `0`–`9`;
  - is generated with the [`nanoid`](https://github.com/ai/nanoid) library
    (`customAlphabet` with the alphabet above and a size of 6), which uses a
    cryptographically secure random generator;
  - is checked case-insensitively, after trimming spaces;
  - is valid for 15 minutes;
  - can be used once;
  - is stored only as a hash;
  - stops working when a new code is sent to the same user.
- **LG-53** The reset email contains the code, how long it is valid, and a note
  that the user can ignore the email if they did not ask for it. It does not
  contain the user's password or any link that logs the user in.
- **LG-54** After the form is submitted, the web client sends the user to the
  Confirm password reset page, with the email filled in.

### Confirm password reset page

- **LG-55** The Confirm password reset page has:
  - **Email** (required, must be a valid email), filled in from the Forgot
    password page if the user came from there;
  - **Reset code** (required, exactly 6 letters or digits);
  - **New password** (required, must meet the password policy in
    [REQ-AUTH-002](auth-password-policy.md), with the policy and strength meter
    shown as in PP-13 and PP-14);
  - **Repeat new password** (required, must match the new password);
  - a **Reset password** button;
  - a link to the Forgot password page to request a new code.
- **LG-56** If the email and reset code match a valid code, the user is not
  disabled, and the password meets the policy, the backend saves the hash of the
  new password (PP-12) and marks the code as used. The web client sends the user
  to the login page with the message "Your password has been reset. You can now
  log in". The user is **not** logged in automatically.
- **LG-57** When a password is reset, the backend revokes every session of that
  user.
- **LG-58** If the email and code do not match a valid code (unknown email,
  wrong, expired or used code), or the user is disabled, the API responds with
  the same generic error, "The code is invalid or has expired". The web client
  shows it and keeps the other fields.
- **LG-59** After **5** wrong codes for the same user, the current code stops
  working, and the user has to request a new one.
- **LG-60** If the password does not meet the policy, the error is as in PP-10
  and the code stays valid.

### Configuration

- **LG-61** The backend reads these environment variables:

| Variable                             | Required | Meaning                                                   |
| ------------------------------------ | -------- | --------------------------------------------------------- |
| `FRONT_BURNER_JWT_SECRET`            | Yes      | Secret used to sign auth tokens. At least 32 characters.  |
| `FRONT_BURNER_AUTH_TOKEN_TTL`        | No       | Auth token lifetime. Default `15m`.                       |
| `FRONT_BURNER_REFRESH_TOKEN_TTL`     | No       | Session and refresh token lifetime. Default `30d`.        |
| `FRONT_BURNER_LOGIN_AUDIT_RETENTION` | No       | How long login audit log entries are kept. Default `90d`. |

- **LG-62** Durations are written as a number followed by a unit: `s`, `m`, `h`
  or `d` (for example `15m`, `12h`, `30d`).
- **LG-63** If `FRONT_BURNER_JWT_SECRET` is missing or shorter than 32
  characters, or a duration cannot be read, the backend refuses to start and
  logs which variable is wrong.
- **LG-64** Changing `FRONT_BURNER_JWT_SECRET` makes all existing auth tokens
  invalid. Clients then refresh them (LG-40), so users stay logged in.

### Security

- **LG-65** The login, refresh, OIDC callback, forgot password and confirm
  password reset endpoints are rate-limited by client IP address. Forgot
  password is also rate-limited per email. A rate-limited request gets `429 Too
  Many Requests`, whether or not the email has an account.
- **LG-66** Passwords, tokens, reset codes, OIDC codes and client secrets are
  never logged.
- **LG-67** These events are written to the backend log, with no secrets:
  successful login, failed login (LG-47), logout, refresh token reuse, password
  reset requested, password reset completed, and failed reset code.
- **LG-68** When the web client is opened over plain HTTP from an address other
  than `localhost`, the login page shows a warning that the instance is not
  served over HTTPS and that users will not stay logged in, with a link to the
  deployment guide.

## Acceptance criteria

- **AC-AUTH-003.1** The login page, Forgot password page and Confirm password
  reset page can be opened without being logged in.
- **AC-AUTH-003.2** On an instance without OIDC, the login page shows only the
  username + password form. With OIDC configured, it also shows **Log in with
  OIDC**.
- **AC-AUTH-003.3** Logging in with a correct email and password returns an auth
  token in the response body and sets the refresh token in an `HttpOnly`,
  `Secure`, `SameSite=Strict` cookie. The refresh token does not appear in the
  response body, and the user reaches the page they first asked for.
- **AC-AUTH-003.4** Logging in with an email in a different letter case works.
- **AC-AUTH-003.5** Logging in with a wrong password, an unknown email, the
  email of an OIDC user, the email of an invited user who has not set a
  password, or the email and correct password of a disabled user returns exactly
  the same `401` response with "Wrong username or password". Each attempt is in
  the login audit log with its own reason code.
- **AC-AUTH-003.6** A login request that asks for **body** delivery gets the
  refresh token in the response body and no cookie.
- **AC-AUTH-003.7** A successful OIDC login returns tokens the same way as a
  password login, and no token appears in any URL.
- **AC-AUTH-003.8** An OIDC login that is cancelled at the provider, one for a
  disabled user, and one refused because automatic registration is disabled all
  show the same "OIDC login failed" message. The login audit log and the backend
  log show the different reasons, including the provider's error code.
- **AC-AUTH-003.9** With automatic registration disabled, an OIDC login with an
  email that no administrator added is refused and creates no account. With it
  enabled, the same login creates an OIDC user.
- **AC-AUTH-003.10** An auth token is refused after
  `FRONT_BURNER_AUTH_TOKEN_TTL`. With the variable unset, it is refused after 15
  minutes.
- **AC-AUTH-003.11** When the auth token expires, the web client refreshes it
  and the failed request succeeds without the user noticing. When two tabs need
  a refresh at the same time, only one refresh request is sent and the session
  is not revoked.
- **AC-AUTH-003.12** Using a refresh token a second time after it was rotated
  revokes the session: both the newest auth token and refresh token stop
  working, and the reuse is in the login audit log.
- **AC-AUTH-003.13** A refresh request with the cookie but without the custom
  header (LG-33), or from another origin, is refused.
- **AC-AUTH-003.14** When the refresh fails, the user is sent to the login page
  with "Your session has expired. Please log in again".
- **AC-AUTH-003.15** After logout, the old auth token and refresh token are
  refused and the cookie is cleared, even if the auth token had already expired.
- **AC-AUTH-003.16** When an administrator disables a logged-in user, all of
  that user's sessions are revoked at once: their next API request fails, the
  refresh fails, and they are sent to the login page.
- **AC-AUTH-003.17** The backend does not start without
  `FRONT_BURNER_JWT_SECRET`, or with one shorter than 32 characters.
- **AC-AUTH-003.18** Submitting the Forgot password form with an unknown email,
  the email of a disabled user, and the email of an active password user gives
  the same response, and only the active password user receives an email.
- **AC-AUTH-003.19** The reset code has 6 characters from `A`–`Z` and `0`–`9`,
  and is accepted in lowercase.
- **AC-AUTH-003.20** A reset code is refused after 15 minutes, after it was
  used, after a new code was sent, after 5 wrong attempts, and after the user
  was disabled.
- **AC-AUTH-003.21** Resetting the password with a valid code and a password
  that meets REQ-AUTH-002 sends the user to the login page with a success
  message. The old password stops working, the new one works, and every existing
  session of that user is revoked.
- **AC-AUTH-003.22** A new password that does not meet REQ-AUTH-002 is refused
  with the errors from PP-10, and the code can still be used.
- **AC-AUTH-003.23** Without SMTP configured, the login page has no **Forgot
  password?** link.
- **AC-AUTH-003.24** Too many login attempts get `429 Too Many Requests`, for
  known and unknown emails alike.
- **AC-AUTH-003.25** Login audit log entries older than
  `FRONT_BURNER_LOGIN_AUDIT_RETENTION` are deleted, and no entry contains a
  password, token or code.
- **AC-AUTH-003.26** Opening the login page over plain HTTP from an address
  other than `localhost` shows the HTTPS warning. Opening it over HTTPS or on
  `localhost` does not.

## Out of scope

- Administrator onboarding ([REQ-AUTH-001](auth-onboarding.md)) and onboarding
  of invited users (separate requirement).
- How administrators disable and enable users, and how they view the login audit
  log (user management, separate requirement). This requirement only covers what
  a disabled user can and cannot do, and what is recorded.
- Changing the password while logged in.
- Showing a user their sessions, logging out of all sessions, or an
  administrator revoking a user's sessions without disabling them. The session
  storage in LG-30 makes these possible later.
- Multi-factor authentication.
- Account lockout after failed logins (rate limiting is used instead).
- "Remember me" options.
- More than one OIDC provider per instance.
- OIDC logout at the provider (RP-initiated logout).

## Open questions

None at the moment.
