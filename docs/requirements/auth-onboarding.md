# REQ-AUTH-001: Administrator onboarding

Status: draft

## Summary

When an instance starts with no users, someone has to create the first
administrator. There are two ways to do this:

- **Through the Administrator onboarding page.** The operator sets a setup
  token in an environment variable of the container. The person who opens the
  instance enters that token and chooses a login method:
  - **username + password**: they enter their details, Front Burner creates
    the administrator, and onboarding ends right away;
  - **OIDC**: they configure the OIDC provider and give the email of the
    administrator account. Onboarding ends only after the first successful
    OIDC login with that email.
- **Through environment variables.** The operator gives the OIDC settings and
  the administrator email as environment variables of the container. The
  Administrator onboarding page is never shown. Onboarding ends after the
  first successful OIDC login with that email.

When onboarding ends, it is disabled for good.

## Context

- The vision says password users are always invited by an administrator, and
  invitations need SMTP. A new instance has no administrator and no SMTP
  configuration, so the first administrator needs a separate path, and that
  path must not send email.
- An instance may be reachable from the internet before the operator finishes
  onboarding. Without protection, whoever opens it first could make
  themselves its administrator. A setup token stops this. The token comes from
  an environment variable rather than the container log, because containers
  usually run in the background and the operator does not see their output.
- An OIDC setup can be wrong (wrong issuer, client ID, secret or redirect
  URI), and Front Burner can only be sure it works after a real login. The
  OIDC path therefore stays open until that login succeeds, so the operator
  is never locked out of a new instance.
- Operators who deploy automatically want to configure the instance without
  using the UI, so OIDC can also be set up entirely through environment
  variables.

## Terms

**Administrator onboarding**
: The one-time flow that creates the first administrator of an instance. Not
the same as _onboarding_ in the glossary, which is how an invited user sets
their password. _Short form_: admin onboarding.

**Setup token**
: A secret that the operator sets in the `FRONT_BURNER_SETUP_TOKEN`
environment variable. It must be entered on the Administrator onboarding page
before anything can be submitted.

**Onboarding state**
: An instance-wide state, stored by the backend, with one of these values:

| State          | Meaning                                                                                                                 |
|----------------|-------------------------------------------------------------------------------------------------------------------------|
| `required`     | There are no users. Administrator onboarding is enabled.                                                                |
| `oidc-pending` | OIDC settings and the administrator email are known, but no OIDC login has succeeded yet. Onboarding is still enabled. |
| `completed`    | An administrator exists. Administrator onboarding is disabled for good.                                                 |

## Requirements

### General

- **AO-1** The backend works out the onboarding state on startup and keeps it
  up to date:
  - if there is at least one user, the state is `completed`;
  - if there are no users and OIDC is configured through environment
    variables (AO-30), or a pending OIDC setup is saved (AO-20), the state is
    `oidc-pending`;
  - otherwise the state is `required`.
- **AO-2** While the state is `required`, or `oidc-pending` from a setup made
  on the onboarding page, the web client sends every route to the
  Administrator onboarding page. The one exception is the login page while
  the state is `oidc-pending`, so the administrator can try OIDC (see AO-21).
- **AO-3** While the state is `completed`:
  - the Administrator onboarding page cannot be reached and the web client
    sends visitors to the login page;
  - every onboarding API endpoint, including the onboarding state endpoint
    (AO-5), responds with `404 Not Found` and changes nothing, as if Front
    Burner had no onboarding at all. The response is the same as for any
    unknown route, so it does not reveal that onboarding exists. Clients
    treat a `404` from the onboarding state endpoint as `completed`.
- **AO-4** The backend enforces onboarding rules. Hiding pages in the web
  client is not enough, because native clients must be possible later (vision
  goal 12).
- **AO-5** The API exposes the onboarding state, and whether OIDC is
  configured through environment variables, without authentication, so
  clients can decide what to show. It does not expose any other data, such as
  OIDC settings, the administrator email or the setup token.
- **AO-6** Completing onboarding is atomic. If two onboarding requests arrive
  at the same time, exactly one succeeds and the other is refused. The
  instance never ends up with two administrators created by onboarding.
- **AO-7** The Administrator onboarding page is fully usable in desktop and
  mobile browsers.

### Setup token

- **AO-8** The setup token is read from the `FRONT_BURNER_SETUP_TOKEN`
  environment variable. It must be at least 16 characters long. A shorter
  value counts as not set, and the backend logs a warning.
- **AO-9** If the state is `required` or `oidc-pending` (from the onboarding
  page) and no valid setup token is set, the Administrator onboarding page
  explains how to set `FRONT_BURNER_SETUP_TOKEN` and restart the container.
  Every onboarding API endpoint that changes data responds with
  `404 Not Found` and changes nothing, as in AO-3.
- **AO-10** The Administrator onboarding page asks for the setup token before
  the user chooses a login method. Every onboarding request that changes data
  must include the token. The backend compares it in constant time. If the
  token is missing or does not match, the endpoint responds with
  `404 Not Found` and changes nothing, as in AO-3. The web client shows this
  as an invalid setup token.
- **AO-11** The web client never stores the setup token persistently (for
  example in local storage or cookies). If the user comes back to the page,
  for example after a failed OIDC login, they enter the token again.
- **AO-12** The setup token is not needed for OIDC login, and is not needed
  when OIDC is configured through environment variables.
- **AO-13** Once the state is `completed`, the setup token is ignored. The
  documentation tells operators that they can remove the environment variable.

### Choosing a login method

- **AO-14** After the setup token is accepted, the Administrator onboarding
  page explains that the user is setting up the first administrator account,
  and offers two choices:
  - set up with **username + password**;
  - set up with **OIDC**.
- **AO-15** The user can go back and change their choice until they submit.
- **AO-16** While the state is `oidc-pending`, the page still offers both
  choices. The OIDC choice is pre-filled with the saved settings. Choosing
  username + password and completing it (AO-17 to AO-20) discards the pending
  OIDC setup.

### Username + password path

- **AO-17** The form asks for:
  - email address (required, must be a valid email), which is the username;
  - display name (required);
  - password (required, must meet the password policy in
    [REQ-AUTH-002](auth-password-policy.md));
  - password confirmation (required, must match the password).
- **AO-18** The form shows the password policy before the user submits, and
  shows field errors inline.
- **AO-19** When the form is submitted successfully, the backend:
  1. creates a password user with the administrator role, using the details
     given;
  2. stores the password using the same hashing as every other password user;
  3. sets the onboarding state to `completed`.

  No invitation or other email is sent.
- **AO-20** The web client then shows a confirmation and sends the user to
  the login page. The user is **not** logged in automatically. They can then
  log in with the email and password they entered.

### OIDC path

- **AO-21** The form asks for:
  - issuer URL (required, HTTPS);
  - client ID (required);
  - client secret (required);
  - scopes (optional, default `openid email profile`);
  - **Require verified email** checkbox (checked by default). When checked,
    an OIDC login is accepted only if the provider says the email is verified
    (`email_verified` claim is `true`). Some self-hosted providers do not
    send this claim, so the operator can turn it off;
  - administrator email address (required, must be a valid email), which is
    used to link the administrator account to the identity at the OIDC
    provider.
- **AO-22** The form shows the **redirect URI** that the operator must
  register with the OIDC provider, read-only and with a copy button.
- **AO-23** When the form is submitted, the backend fetches the provider's
  discovery document (`<issuer>/.well-known/openid-configuration`) and checks
  that it can be reached and that its `issuer` matches the issuer URL. If
  not, the form shows the error and nothing is saved. This check cannot find
  every problem (for example a wrong client secret), which is why AO-26
  exists.
- **AO-24** When the check passes, the backend:
  1. saves the OIDC settings, including the **Require verified email**
     choice, as system settings, storing the client secret protected like
     other secrets (vision goal 11);
  2. saves the administrator email as the pending administrator;
  3. sets automatic registration to **disabled**;
  4. sets the onboarding state to `oidc-pending`.

  No user is created yet.
- **AO-25** The web client then sends the user to the login page, which
  offers OIDC login.
- **AO-26** While the state is `oidc-pending`, if an OIDC login fails for any
  reason, the web client sends the user back to the Administrator onboarding
  page with the OIDC form pre-filled and a message saying why the login
  failed. Reasons include: the provider cannot be reached, the provider
  returns an error, the token exchange fails, the ID token is invalid, or the
  email is not verified. The client secret is not shown again; the user
  leaves it blank to keep it or enters a new one.
- **AO-27** While the state is `oidc-pending`, the OIDC login succeeds only if
  the email in the ID token matches the pending administrator email
  (case-insensitive) and, when **Require verified email** is on, the email is
  verified. If the emails do not match, the login is refused, no account is
  created, and AO-26 applies with a message saying the email does not match.
- **AO-28** When the first OIDC login succeeds, the backend, in one atomic
  step:
  1. creates an OIDC user with the administrator role, linked to the provider
     identity (issuer + `sub`) and the email;
  2. clears the pending administrator email;
  3. sets the onboarding state to `completed`.
- **AO-29** The new administrator is then logged in as for a normal OIDC
  login.

### OIDC through environment variables

- **AO-30** The operator can configure OIDC and the first administrator with
  these environment variables:

| Variable                                   | Required | Meaning                                                   |
|--------------------------------------------|----------|-----------------------------------------------------------|
| `FRONT_BURNER_OIDC_ISSUER`                 | Yes      | Issuer URL (HTTPS).                                       |
| `FRONT_BURNER_OIDC_CLIENT_ID`              | Yes      | Client ID.                                                |
| `FRONT_BURNER_OIDC_CLIENT_SECRET`          | Yes      | Client secret.                                            |
| `FRONT_BURNER_OIDC_SCOPES`                 | No       | Scopes. Default `openid email profile`.                   |
| `FRONT_BURNER_OIDC_REQUIRE_VERIFIED_EMAIL` | No       | `true` or `false`, as in AO-21. Default `true`.           |
| `FRONT_BURNER_ADMIN_EMAIL`                 | Yes      | Email of the first administrator, as in AO-21.            |

- **AO-31** OIDC counts as configured through environment variables only when
  all required variables are set. If some OIDC variables are set but not all
  required ones, or if `FRONT_BURNER_ADMIN_EMAIL` is set without them, the
  backend refuses to start and logs which variables are missing or invalid.
- **AO-32** On startup, the backend fetches the discovery document as in
  AO-23. If the check fails, the backend still starts, logs the error, and
  the login page shows that OIDC is not available.
- **AO-33** When OIDC is configured through environment variables and there
  are no users:
  - the onboarding state is `oidc-pending`, with `FRONT_BURNER_ADMIN_EMAIL`
    as the pending administrator;
  - automatic registration is **disabled**;
  - the Administrator onboarding page is never shown, and the web client
    sends every route to the login page, which offers OIDC login;
  - the setup token is not used, and the onboarding API endpoints that change
    data respond with `404 Not Found` and change nothing, as in AO-3.
- **AO-34** The first OIDC login follows AO-27 to AO-29. If it fails, the
  login page shows why. The operator fixes the environment variables and
  restarts the container.
- **AO-35** While OIDC is configured through environment variables, those
  variables are the only source of the OIDC settings. System settings show
  them read-only and say that they come from the environment.
- **AO-36** Once the state is `completed`, `FRONT_BURNER_ADMIN_EMAIL` is
  ignored. Changing it does not create another administrator or change any
  existing user.

### Security

- **AO-37** Onboarding API endpoints are rate-limited.
- **AO-38** Passwords, client secrets and the setup token are never logged
  and never returned by the API.
- **AO-39** Onboarding events (started, setup token rejected, OIDC setup
  saved, OIDC login failed while pending, completed) are written to the
  backend log, with no secrets.

## Acceptance criteria

1. On a fresh instance with an empty database and no OIDC environment
   variables, opening any web client URL shows the Administrator onboarding
   page.
2. If `FRONT_BURNER_SETUP_TOKEN` is not set, the page explains how to set it,
   and onboarding requests that change data return `404 Not Found`.
3. Onboarding requests with a missing or wrong setup token return
   `404 Not Found` and change nothing.
4. Completing the username + password path creates exactly one administrator,
   sends the user to the login page, and that user can log in. After that,
   the onboarding page and onboarding API cannot be reached.
5. A password that does not meet REQ-AUTH-002 is refused.
6. Completing the OIDC path with a valid configuration sends the user to the
   login page. After a successful OIDC login with the matching email, an OIDC
   administrator exists and is logged in, and onboarding cannot be reached.
7. Completing the OIDC path with a wrong client secret, then trying to log
   in, brings the user back to the onboarding page with the form pre-filled.
   Fixing the secret and logging in again completes onboarding.
8. While OIDC onboarding is pending, an OIDC login with a different email is
   refused and creates no account.
9. With **Require verified email** on, an OIDC login whose `email_verified`
   claim is missing or `false` is refused. With it off, the same login is
   accepted.
10. While OIDC onboarding is pending, switching to the username + password
    path and completing it creates a password administrator and discards the
    pending OIDC setup.
11. With all required OIDC environment variables set and an empty database,
    the onboarding page is never shown. The first OIDC login with
    `FRONT_BURNER_ADMIN_EMAIL` creates an OIDC administrator. Onboarding
    requests that change data return `404 Not Found`.
12. With only some of the required OIDC environment variables set, the
    backend refuses to start and names the missing variables.
13. Two onboarding requests sent at the same time create only one
    administrator.
14. With onboarding `completed`, calling any onboarding endpoint directly
    returns `404 Not Found`, the same response as an unknown route, and
    changes nothing.

## Out of scope

- SMTP configuration. It is done later from system settings.
- Inviting more users or changing system settings beyond what is listed
  here.
- Recovering an instance where all administrators are lost (an operator task,
  to be covered by a separate requirement).
- Turning onboarding back on once it is `completed`.
- Configuring other system settings through environment variables.

## Open questions

None at the moment.
