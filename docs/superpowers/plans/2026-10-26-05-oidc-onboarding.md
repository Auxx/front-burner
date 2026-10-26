# OIDC Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 5 of [the index](2026-10-26-00-roadmap.md): on the Administrator
onboarding page the operator can choose **OIDC**, enter the provider's settings
and the administrator email, and is sent to the login page; the first OIDC login
with that email completes onboarding. A failed login brings them back to the
form, pre-filled, with the reason.

**Architecture:** Two more onboarding endpoints behind the existing
`OnboardingGuard` and the `setup-token` rate-limit group: one checks the
provider's discovery document and saves the settings (client secret encrypted in
`system_settings`, pending administrator email in `instance_state`), one returns
the saved settings without the secret for the pre-filled form. Plan 4's
`OidcSettingsService` already reads `system_settings`, so the login flow needs
no change. The web client enables the OIDC choice and adds an OIDC form step.

**Tech Stack:** as in plan 4. No new packages.

**Spec:** `docs/requirements/auth-onboarding.md` AO-1, AO-2, AO-9 to AO-11,
AO-14 to AO-16, AO-20 to AO-26, AO-37 to AO-39; criteria 6, 7, 10. Architecture:
`data.md` A-4.4, A-4.8; `security.md` A-7.8.

## Global Constraints

- The shared constraints of [the index](2026-10-26-00-roadmap.md) apply.
- Reuses plan 4's `systemSettings`, `instanceState.pendingAdminEmail`,
  `OidcSettingsService`, `startMockOidcProvider`, the `oidcError` redirect to
  `/onboarding` and the texts `web-feature-auth.oidcErrors.<reason>`; plan 3's
  `SecretBox` and `EgressHttpClient`; plan 1's `ApiErrorException.forFields`.
- Both new endpoints take the setup token in the body and answer the
  unknown-route `404` exactly as the existing ones do (AO-3, AO-9, AO-10,
  AO-33). They are `@Public()` and in the `setup-token` rate-limit group
  (AO-37).
- The client secret is never returned, logged or kept by the web client after
  submitting (AO-26, AO-38).
- The redirect URI shown on the form is
  `` `${location.origin}/api/v1/auth/oidc/callback` ``, the same value plan 4's
  backend uses.

## Review Focus

- **An issuer typed with a trailing slash** (`https://id.example.com/` while the
  provider's `issuer` is `https://id.example.com`) is a common mistake; it must
  be refused with "issuer does not match" on the issuer field, not saved to fail
  later at login → Task 2 test `refuses an issuer that differs from the
  discovery document's`.
- **Coming back after a failed login and leaving the secret blank** must keep
  the saved secret (AO-26); a blank secret with nothing saved must be refused on
  the field → Task 2 tests `keeps the saved secret when it is left blank` and
  `requires a secret when none is saved`.
- **Choosing username + password while OIDC is pending** must discard the
  pending setup in the same transaction that creates the administrator, so a
  later OIDC login cannot create a second administrator (AO-16, criterion 10) →
  Task 3 test `discards the pending OIDC setup`.
- **The issuer pointing at a blocked address** (`https://169.254.169.254`) must
  be refused as unreachable, the same as any other host that does not answer
  (AR-57) → Task 2 test `reports a blocked issuer as unreachable`.
- **A reload of the onboarding page after a failed login** (`?oidcError=…` in
  the URL, token lost from memory, AO-11) must ask for the token again and then
  show the reason and the pre-filled form, not lose the reason → Task 4 test
  `keeps the OIDC error until the token is entered`.

---

### Task 1: OIDC setup contracts

**Files:**

- Modify: `libs/shared/contracts/src/onboarding/onboarding.schema.ts` (+
  `.spec.ts`), `errors/error-codes.ts` is unchanged (field codes are feature
  codes)

**Interfaces:**

- Produces:
  - `DEFAULT_OIDC_SCOPES = 'openid email profile'`.
  - `oidcSetupFields = { issuer: z.url({ protocol: /^https$/ }).max(2048)
    .refine(no query or fragment); clientId: z.string().trim().min(1).max(256);
    clientSecret: z.string().max(1024).optional(); scopes:
    z.string().trim().max(512).default(DEFAULT_OIDC_SCOPES).refine(contains the
    word openid, { params: { code: 'missing-openid' } }); requireVerifiedEmail:
    z.boolean().default(true); adminEmail:
    z.string().trim().pipe(z.email().max(254)) }` (AO-21). The secret is never
    trimmed; empty means "keep" (AO-26).
  - `OidcSetupRequestSchema` (`id: 'OidcSetupRequest'`): `{ setupToken,
    ...oidcSetupFields }`.
  - `OidcSetupViewSchema` (`id: 'OidcSetupView'`): `{ issuer, clientId, scopes,
    requireVerifiedEmail, adminEmail, hasClientSecret: boolean }`.
  - `OIDC_SETUP_FIELD_CODES = ['oidc-issuer-unreachable',
    'oidc-issuer-mismatch', 'oidc-discovery-invalid', 'required']`, used as
    field codes on `issuer` (the first three) and `clientSecret` (`required`).
  - Types `OidcSetupRequest`, `OidcSetupView`.

- [ ] **Step 1: Write the failing tests**: `refuses an http issuer`; `refuses an
      issuer with a query`; `defaults the scopes and the flag`; `refuses scopes
      without openid` (field code `missing-openid`); `does not trim the client
      secret`; `trims the admin email`; ids.
- [ ] **Step 2: Run them and see them fail** — `npx nx test shared-contracts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx test shared-contracts`.
- [ ] **Step 5: Commit** — `feat(contracts): add the OIDC onboarding schemas`

---

### Task 2: Saving the OIDC setup

**Files:**

- Create: `libs/server/feature/auth/src/onboarding/oidc-setup.service.ts` (+
  `.spec.ts`)
- Modify: `onboarding.controller.ts` (+ `.spec.ts`), `onboarding.dto.ts`,
  `onboarding.module.ts`, `onboarding-state.service.ts`

**Interfaces:**

- Consumes: `EgressHttpClient`, `SECRET_BOX`, `systemSettings`, `instanceState`,
  `ApiErrorException.forFields`, `startMockOidcProvider`.
- Produces:
  - `OidcSetupService.check(issuer: string): Promise<void>` — `client.discovery`
    through `EgressHttpClient` with a 10-second timeout; maps a network error,
    timeout or `EgressRefusedError` to field `issuer` code
    `oidc-issuer-unreachable` with `params: { host }`; an `issuer` in the
    document that differs from the given URL (exact string comparison, as OpenID
    Connect Discovery requires) to `oidc-issuer-mismatch` with `params: {
    expected: <document's issuer> }`; anything else to `oidc-discovery-invalid`
    (AO-23).
  - `OidcSetupService.save(request: OidcSetupRequest): Promise<void>` — runs
    `check`, then in one transaction that requires the state to be `required` or
    `oidc-pending` (else the unknown-route `404`): writes the OIDC columns of
    `system_settings` row 1 (the secret encrypted; an empty secret keeps the
    stored one, or fails with field `clientSecret` code `required` when none is
    stored), `automaticRegistration = false`, `pendingAdminEmail`, and state
    `oidc-pending` (AO-24). Logs "OIDC setup saved" (AO-39).
  - `OidcSetupService.current(): OidcSetupView | undefined`.
  - Routes (`OnboardingController`, tag `onboarding`, `@RateLimitGroup
    ('setup-token')`): `saveOidcSetup()`: `POST onboarding/oidc-setup` → `204`;
    `currentOidcSetup()`: `POST onboarding/oidc-setup/current`
    (`SetupTokenRequest`) → `200 OidcSetupView`, or the unknown-route `404` when
    none is saved _(plan's call: POST, because the token travels in the body)_.

- [ ] **Step 1: Write the failing tests** (mock provider, test database): `saves
      the settings and puts onboarding in oidc-pending` (the stored secret
      decrypts to the one sent; the state is `oidc-pending`; automatic
      registration is off; no user exists, AO-24); `refuses an issuer that
      differs from the discovery document's` (trailing slash); `reports an
      unreachable issuer on the field` (nothing saved); `reports a blocked
      issuer as unreachable`; `keeps the saved secret when it is left blank`;
      `requires a secret when none is saved`; `returns the saved setup without
      the secret`; controller: `answers 404 for a wrong token, before validating
      the body`; `answers 404 when OIDC comes from the environment`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-auth`.
- [ ] **Step 3: Implement**, and regenerate the API client.
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test lint -p
      server-feature-auth web-api-client`.
- [ ] **Step 5: Commit** — `feat(auth): save the OIDC onboarding setup`

---

### Task 3: Password setup while OIDC is pending

**Files:**

- Modify: `libs/server/feature/auth/src/onboarding/onboarding.service.ts` (+
  `.spec.ts`)

**Interfaces:**

- Produces: `OnboardingService.setUpPassword` accepts the states `required` and
  `oidc-pending` (from the onboarding page only; the guard already hides it when
  OIDC comes from the environment) and, in the same transaction, sets the OIDC
  columns of `system_settings` and `pendingAdminEmail` to `null` (AO-16).

- [ ] **Step 1: Write the failing tests**: `discards the pending OIDC setup`
      (after saving a setup, a password setup creates the administrator, and
      `OidcSettingsService.current()` is `undefined`); `still refuses a
      completed onboarding`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-auth`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx test
      server-feature-auth`.
- [ ] **Step 5: Commit** — `feat(auth): let the password path replace a pending
      OIDC setup`

---

### Task 4: The OIDC step of the onboarding page

**Files:**

- Create (generated component):
  `libs/web/feature-auth/src/auth/components/oidc-setup-step/`
  (`auth-oidc-setup-step`, + `.spec.ts`)
- Modify: `login-method-step.component.*` (OIDC enabled, the "not available yet"
  note removed; emits the chosen method), `onboarding.page.*`,
  `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `OnboardingApi.saveOidcSetup()`, `OnboardingApi.currentOidcSetup()`,
  `OnboardingStateService.refresh()`.
- Produces:
  - `LoginMethodStepComponent.chosen: output<'password' | 'oidc'>`, with an
    `initial` input; while the state is `oidc-pending` the page passes `'oidc'`
    (AO-16).
  - `OidcSetupStepComponent`, inputs `setupToken: string`, `saved: OidcSetupView
    | undefined`, `failure: OidcFailureReason | undefined`; outputs `back`,
    `refused` (as the password step's), `saved`. Fields in AO-21's order with
    Signal Forms on `oidcSetupFields`: **Issuer URL**, **Client ID**, **Client
    secret** (masked with `uiPasswordReveal`; when `saved.hasClientSecret`,
    optional with the hint "Leave blank to keep the saved secret"), **Scopes**,
    **Require verified email** (`ui-checkbox`, with AO-21's explanation as its
    hint), **Administrator email**. Above them the **Redirect URI**, read-only,
    with a **Copy** button that writes it to the clipboard and shows the toast
    "Copied" (AO-22). Backend field codes appear inline
    (`oidc-issuer-unreachable`: "Can't reach this issuer.",
    `oidc-issuer-mismatch`: "The provider says its issuer is {expected}.",
    `oidc-discovery-invalid`: "This address doesn't serve an OpenID Connect
    discovery document."). On success it emits `saved`.
  - `OnboardingPage`: after the token step, while the state is `oidc-pending` it
    loads `currentOidcSetup` for the pre-fill (AO-16, AO-26). The page reads
    `oidcError` from the query once, keeps it in memory, and shows its text from
    `web-feature-auth.oidcErrors.<reason>` above the OIDC form until the next
    submit (AO-26). On `saved` it calls `refresh()` and navigates to `/login`
    (AO-25).

- [ ] **Step 1: Write the failing tests**: method step `offers OIDC` and
      `preselects OIDC while pending`; OIDC step `shows the redirect URI and
      copies it`, `disables submit until the form is valid`, `makes the secret
      optional when one is saved`, `shows the backend's issuer error on the
      field`, `emits saved after a successful submit`; page `pre-fills the form
      while pending`, `keeps the OIDC error until the token is entered`, `goes
      to the login page after saving`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-feature-auth`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test lint -p
      web-feature-auth && npx nx build web`.
- [ ] **Step 5: Commit** — `feat(web): set up OIDC on the onboarding page`

---

### Task 5: OIDC onboarding end-to-end tests

**Files:**

- Modify: `apps/server-e2e/src/onboarding.e2e.spec.ts`
- Modify: `apps/web-e2e/src/onboarding.spec.ts`

- [ ] **Step 1: Write the tests**:
  - `server-e2e` (mock provider, `NODE_EXTRA_CA_CERTS`): REQ-AUTH-001 criteria 6
    (save → `oidc-pending` → OIDC login with the admin email → administrator
    created and logged in → onboarding endpoints answer the unknown-route 404),
    7 (mock `failTokenRequest(401)`: the callback redirects to
    `/onboarding?oidcError=code-exchange-failed`; save again with the secret
    left blank and a fixed provider: login completes), 10 (save OIDC, then the
    password path: one password administrator, `auth/methods` reports OIDC
    `not-configured`); `saving answers 404 once onboarding is completed`.
  - `web-e2e` (`ignoreHTTPSErrors` for the provider): the whole OIDC path from
    `/` with the setup token to the dashboard; the failing path of criterion 7
    in the browser (the form comes back pre-filled with the reason); axe on the
    OIDC step; 320 px width.
- [ ] **Step 2: Run them** — `npx nx e2e server-e2e && npx nx e2e web-e2e`.
      Expected: PASS.
- [ ] **Step 3: Commit** — `test(e2e): cover OIDC onboarding`
