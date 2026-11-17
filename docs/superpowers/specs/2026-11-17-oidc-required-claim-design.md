# OIDC required claim (temporary MVP measure) — design

> Status: **Draft**, awaiting approval

## Intent

The operator wants to test the MVP with a small group of people who sign in with
Slack OIDC, and keep everyone else out. Today this cannot work:

- the MVP turns automatic registration off at OIDC onboarding (AO-24, AO-33);
- the toggle that turns it back on, user management and the OIDC allow-list are
  all deferred (`mvp.md`, Out of scope, "Users").

So every OIDC login after the administrator's fails with
`registration-disabled`.

This change adds an optional **required claim**: a claim name and a value that
the ID token must carry. When it is set, it limits who can log in, and it also
turns on automatic registration for people who match. For Slack, the claim name
is `https://slack.com/team_id` and the value is the workspace ID.

It is a **temporary MVP measure**. The documentation says so, and the deferred
OIDC allow-list and automatic registration toggle will replace it after the MVP.

## Goals

- An instance can be set up so that anyone whose ID token has a given claim
  value gets an ordinary user account (role `user`) on first OIDC login.
- Anyone without that claim value is refused.
- It can be set up on the onboarding OIDC form or through environment variables.
- With no required claim set, behaviour is exactly as it is today.

## Non-goals

- A system settings page for changing the required claim after onboarding. There
  is none in the MVP; the environment variables are the way to change it later.
- Several required claims, or several allowed values.
- Re-checking the claim on token refresh. It is checked only at login.

## Anti-goals

- A setting that turns on registration with no filter. Open registration on an
  instance reachable from the internet is exactly what this must not allow.
- Anything that makes removing the measure later hard. Keep it in a few clearly
  marked places.

## Approaches

1. **Slack-specific "Slack team ID" setting.** One field and one variable,
   checking `https://slack.com/team_id`. The simplest option, but it only works
   for Slack.
2. **Generic required claim (chosen).** A claim name plus a value. It works for
   Slack (`https://slack.com/team_id`), Google (`hd`), Keycloak groups and
   similar, so it lasts longer. It costs one more field.
3. **Automatic registration toggle plus a separate filter.** Dropped: two
   settings where one does, and it allows open registration.

The operator picked approach 2 because it is more future-proof.

## Design

### Settings

- **Onboarding OIDC form (AO-21):** two new optional fields, **Required claim
  name** and **Required claim value**. Either both are filled or both are empty.
  The form shows the Slack example as hint text. Like the other OIDC settings,
  they are pre-filled when the user comes back to the form (AO-26). They are not
  secrets.
- **Environment (AO-30):** two new optional variables,
  `FRONT_BURNER_OIDC_REQUIRED_CLAIM_NAME` and
  `FRONT_BURNER_OIDC_REQUIRED_CLAIM_VALUE`. If only one of them is set, the
  backend refuses to start and names the missing one, as AO-31 does.
- **Storage:** two new nullable columns on `system_settings`,
  `oidc_required_claim_name` and `oidc_required_claim_value`, added with a
  migration. As with the other OIDC settings, the environment wins (AO-35).

### Login (changes to LG-18 and LG-20)

When a required claim is set:

1. After the ID token is validated, the backend reads the claim by its exact
   name. It matches when the claim is a string equal to the value, or an array
   that contains a string equal to it. Any other type, or a missing claim, does
   not match.
2. If it does not match, the login fails with a new reason, `claim-mismatch`.
   The reason is added to the login audit reasons (LG-43) and to
   `OIDC_FAILURE_REASONS`. Users see the generic "OIDC login failed" (LG-21), as
   for every other OIDC failure.
3. If it matches and no user is found, the backend creates an ordinary OIDC
   user, as automatic registration would do. The stored `automatic_registration`
   flag is not touched.
4. The other rules still apply: a verified email (LG-19), password-user and
   disabled-user checks.

**Onboarding (my call):** while onboarding is `oidc-pending`, the first
administrator must also match the claim. The check runs before AO-27, and a
mismatch sends them back as in AO-26 (or AO-34) with a message saying the
required claim did not match. Otherwise the filter would have a hole on the very
first login, and a wrong value would only show up when testers fail.

**Existing users (my call):** users who already exist, including the
administrator, are also checked on every login while a required claim is set.
One rule for everyone is easier to reason about. Changing the variable to
another workspace locks out people from the old one.

### Documentation

Each new point is marked **Temporary (MVP)**, with a note that the deferred OIDC
allow-list and automatic registration toggle replace it.

- `docs/requirements/auth-onboarding.md` (REQ-AUTH-001):
  - new AO points for the form fields, the variables and the start-up check;
  - new acceptance criteria.
- `docs/requirements/auth-login.md` (REQ-AUTH-003):
  - the changes to LG-18 and LG-20;
  - `claim-mismatch` in the reason table;
  - acceptance criteria for a match that creates a user and a mismatch that is
    refused.
- `docs/product/mvp.md`:
  - the new points in the scope table;
  - a note in the deferred "Users" row;
  - the Implementation status row.
- `docs/wiki/deployment.md`:
  - the two variables;
  - a short "Limiting OIDC to a Slack workspace" example.
- `docs/architecture/data.md`: the new `system_settings` columns.

### Tests

- Unit tests for claim matching (string, array, missing, other types) and for
  `OidcUserService`: a match creates a user, a mismatch is refused, the
  onboarding case, and an unchanged path when no claim is set.
- Config tests for the variable pair.
- An e2e test with the existing test OIDC provider issuing a custom claim,
  titled with the new acceptance criterion IDs.

## Left to the builder

- New AO, LG and AC numbering, using the ai-tools doc ID tool.
- Form layout and wording, following existing onboarding form patterns.
- Where the claim check lives (inside `OidcUserService.resolve` or just before
  it).
