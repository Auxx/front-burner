# OIDC Required Claim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional OIDC **required claim** (claim name + value). When it
is set, a login whose ID token does not carry the value is refused. A login that
does carry it creates an ordinary user on first login. This is a temporary MVP
measure.

**Architecture:** The claim comes from two optional environment variables, which
win, or from two new nullable `system_settings` columns filled by the onboarding
OIDC form. `OidcSettingsService.current()` exposes it as `requiredClaim`.
`OidcUserService.resolve()` checks it right after the verified-email check,
before the onboarding and find-or-create paths. A match skips the automatic
registration check.

**Tech Stack:** NestJS, Drizzle (SQLite), Zod contracts in `shared-contracts`,
Angular signal forms, Transloco, Vitest, `oauth2-mock-server`.

**Spec:** `docs/superpowers/specs/2026-11-17-oidc-required-claim-design.md`

## Global Constraints

- Load the `development-workflow` skill before the first code change, and the
  `angular-templates` skill before touching the template (CLAUDE.md).
- Change files with `Edit` / `Write` only, never with sed, Python or heredocs
  (CLAUDE.md).
- Environment variables: `FRONT_BURNER_OIDC_REQUIRED_CLAIM_NAME` and
  `FRONT_BURNER_OIDC_REQUIRED_CLAIM_VALUE`. Set both or neither.
- New login audit and failure reason: `claim-mismatch`.
- Slack example: claim name `https://slack.com/team_id`, value is the workspace
  ID (`T…`).
- Matching rule:
  - the claim is read by its exact name;
  - it matches when it is a string equal to the value, or an array that contains
    a string equal to it;
  - any other type, or a missing claim, does not match.
- The claim name and value are trimmed, at most 256 characters each, and
  compared case-sensitively.
- With no required claim set, behaviour is unchanged.
- The stored `automatic_registration` flag is never written by this feature.
- Every doc point added is marked **Temporary (MVP)** and says that the deferred
  OIDC allow-list and automatic registration toggle replace it.
- Test titles start with the AC ID they prove. New IDs:
  - AO-40 to AO-42 and AC-AUTH-001.15 to AC-AUTH-001.17 (REQ-AUTH-001);
  - LG-69 to LG-71 and AC-AUTH-003.27 to AC-AUTH-003.28 (REQ-AUTH-003).

## Review Focus

1. **A saved claim is cleared.** Resubmitting the onboarding form with both
   claim fields empty clears the saved claim (stores `null`); it does not keep
   the old one. Task 2 test.
2. **The environment wins over the onboarding page.** With OIDC saved from the
   onboarding page and the two claim variables set, the variables win
   (`requiredClaim` comes from config). Task 2 test.
3. **A numeric claim.** A claim sent as a number (`12345`) when the value is
   `"12345"` is refused with `claim-mismatch`, without throwing. Task 3 test.
4. **Users who already exist.** An existing linked user, including the
   administrator, whose token lacks the claim is refused with `claim-mismatch`.
   Task 3 test.
5. **Whitespace around the value.** The variable value `" T123 "` matches the
   claim `"T123"`. Task 1 test (trimmed at load).

---

### Task 1: Environment variables

**Files:**

- Modify: `libs/server/core/config/src/config/config.model.ts`
- Modify: `libs/server/core/config/src/config/load-config.ts`
- Test: `libs/server/core/config/src/config/load-config.spec.ts`

**Interfaces:**

- Produces, in `config.model.ts` and exported from the package index like
  `OidcEnvironment`:
  - `export interface RequiredClaim { name: string; value: string; }`
  - on `Config`: `oidcRequiredClaim: RequiredClaim | undefined;`
- These variables are separate from the AO-30 group:
  - they are **not** added to `OIDC_VARIABLES`;
  - they do not make `oidcSet` true;
  - they are valid without any other OIDC variable.

- [ ] **Step 1: Write failing tests** in `load-config.spec.ts`:
  - `AC-AUTH-001.16: refuses a required claim name without a value`. Only
    `FRONT_BURNER_OIDC_REQUIRED_CLAIM_NAME` is set. Expect a `ConfigError` with
    an issue `{ variable: 'FRONT_BURNER_OIDC_REQUIRED_CLAIM_VALUE', message: 'is
    required when FRONT_BURNER_OIDC_REQUIRED_CLAIM_NAME is set' }`.
  - The same test the other way round (only the value is set).
  - `reads the required claim and trims it`. Name `' https://slack.com/team_id
    '` and value `' T123 '` give `oidcRequiredClaim: { name:
    'https://slack.com/team_id', value: 'T123' }`.
  - `has no required claim when neither variable is set`. Expect
    `oidcRequiredClaim` to be `undefined`.
  - `refuses a required claim longer than 256 characters`. Expect an issue on
    that variable.
  - Empty-after-trim counts as set but invalid: expect an issue `'must not be
    empty'`.
- [ ] **Step 2: Run them and check they fail.** `npx nx test server-core-config`
      fails on the new tests.
- [ ] **Step 3: Implement.**
  - Add both variables to the Zod `schema` as `z.string().trim().min(1,
    {message:'must not be empty'}).max(256, {message:'must be at most 256
    characters'}).optional()`. The messages are fixed text, as for the existing
    variables.
  - After the OIDC block, push the pair issue when exactly one is present in
    `input`, and otherwise build `oidcRequiredClaim`.
  - Return it from `loadConfig`.
  - Fix every test helper or fixture that builds a full `Config` (search for
    `knownHostsFile:` in `*.spec.ts` and `testing/`) by adding
    `oidcRequiredClaim: undefined`.
- [ ] **Step 4: Run the checks and make sure they pass.** `npx nx run-many -t
      test,typecheck -p server-core-config server-feature-auth` passes.
- [ ] **Step 5: Commit.** `feat(config): add FRONT_BURNER_OIDC_REQUIRED_CLAIM_*
      variables`

### Task 2: Storage, contracts and onboarding save

**Files:**

- Modify: `libs/server/core/database/src/schema/system-settings.ts`
- Create: `libs/server/core/database/migrations/0014_oidc_required_claim.sql`
  (generated) and its `meta/` snapshot
- Modify: `libs/shared/contracts/src/onboarding/onboarding.schema.ts`
- Test: `libs/shared/contracts/src/onboarding/onboarding.schema.spec.ts`
- Modify: `libs/server/feature/auth/src/onboarding/onboarding.dto.ts`
- Modify: `libs/server/feature/auth/src/onboarding/oidc-setup.service.ts`
- Test: `libs/server/feature/auth/src/onboarding/oidc-setup.service.spec.ts`
- Modify: `libs/server/feature/auth/src/oidc/oidc-settings.service.ts`
- Test: `libs/server/feature/auth/src/oidc/oidc-settings.service.spec.ts`

**Interfaces:**

- Consumes: `Config['oidcRequiredClaim']` and `RequiredClaim` (Task 1).
- Produces:
  - Columns `oidcRequiredClaimName: text('oidc_required_claim_name')` and
    `oidcRequiredClaimValue: text('oidc_required_claim_value')`, both nullable.
  - In `oidcSetupFields`: `requiredClaimName:
    z.string().trim().max(256).default('')` and `requiredClaimValue:
    z.string().trim().max(256).default('')`.
  - `export function refineRequiredClaimPair(value: { requiredClaimName: string;
    requiredClaimValue: string; }, context: z.RefinementCtx): void`. It adds the
    issue `{ code: 'custom', path: [<the empty one>], params: { code:
    'required-claim-pair' } }` when exactly one is non-empty.
    - `OidcSetupRequestSchema` applies it with `.superRefine`.
    - `OidcSetupRequestDto` re-applies it, as `PasswordSetupRequestDto` does for
      its refinement.
  - `OidcSetupViewSchema` gains `requiredClaimName: z.string()` and
    `requiredClaimValue: z.string()`. Empty strings mean none.
  - `OidcSettings` gains `requiredClaim: RequiredClaim | undefined`. The source
    is `config.oidcRequiredClaim` when set, otherwise the saved columns when
    both are non-null, whichever the OIDC `source` is.
  - The `CONFIG` injection type widens to `Pick<Config, 'oidc' |
    'oidcRequiredClaim'>`.

- [ ] **Step 1: Write failing tests.**
  - Contracts spec:
    - `AC-AUTH-001.16: refuses a required claim name without a value`, and the
      reverse. Expect a failed parse whose issue has `params.code ===
      'required-claim-pair'`.
    - Both empty parses, both filled parses, and a 257-character value fails.
  - `oidc-setup.service.spec.ts`:
    - `AC-AUTH-001.15: saves the required claim and returns it for the
      pre-filled form`. After `save({... requiredClaimName:
      'https://slack.com/team_id', requiredClaimValue: 'T123'})`, `current()`
      has those two values.
    - `clears a saved required claim when both fields are empty`. Both columns
      are `null`, and `current()` returns `''` for both.
  - `oidc-settings.service.spec.ts`:
    - `uses the saved required claim`;
    - `the environment's required claim wins over the saved one`;
    - `has no required claim when none is set or saved`.
- [ ] **Step 2: Run them and check they fail.** `npx nx run-many -t test -p
      shared-contracts server-feature-auth` fails on the new tests.
- [ ] **Step 3: Implement.**
  - Add the columns.
  - Generate the migration with `npx nx run server-core-database:db-generate --
    --name oidc_required_claim`. Check that the SQL is two `ALTER TABLE
    system_settings ADD ...` statements.
  - Add the contract fields and the refinement, the DTO refinement, and the
    save/view mapping in `OidcSetupService`. An empty string is stored as
    `null`; the `values` object always writes both columns.
  - Add `requiredClaim` in `OidcSettingsService.current()`.
- [ ] **Step 4: Run the checks and make sure they pass.** `npx nx run-many -t
      test,typecheck,lint -p server-core-database shared-contracts
      server-feature-auth` passes.
- [ ] **Step 5: Regenerate the API.** Run `npx nx run server:openapi && npx nx
      run web-api-client:generate`. `git diff --stat` shows
      `apps/server/openapi.json` and `libs/web/api-client/src/generated/*` with
      the two new fields.
- [ ] **Step 6: Commit.** `feat(auth): store the OIDC required claim from
      onboarding`

### Task 3: Enforce the claim at login

**Files:**

- Create: `libs/server/feature/auth/src/oidc/required-claim.ts`
- Test: `libs/server/feature/auth/src/oidc/required-claim.spec.ts`
- Modify: `libs/server/feature/auth/src/oidc/oidc-login.service.ts:114-123`
- Modify: `libs/server/feature/auth/src/oidc/oidc-user.service.ts`
- Test: `libs/server/feature/auth/src/oidc/oidc-user.service.spec.ts`
- Modify: `libs/server/core/database/src/schema/login-audit.ts`
- Modify: `libs/shared/contracts/src/auth/oidc.schema.ts`
- Test: `apps/server-e2e/src/oidc.e2e.spec.ts`

**Interfaces:**

- Consumes: `OidcSettings.requiredClaim` and `RequiredClaim` (Task 2).
- Produces:
  - `export function matchesRequiredClaim(claims: Readonly<Record<string,
    unknown>>, required: RequiredClaim): boolean` in `required-claim.ts`.
  - `OidcIdentity` gains `claims: Readonly<Record<string, unknown>>`, set from
    `tokens.claims()` in `oidc-login.service.ts`.
  - `'claim-mismatch'` is appended to `LOGIN_AUDIT_REASONS` (after
    `admin-email-mismatch`) and to `OIDC_FAILURE_REASONS` (before `failed`).

- [ ] **Step 1: Write failing tests.**
  - `required-claim.spec.ts`, with `required = { name:
    'https://slack.com/team_id', value: 'T123' }`:
    - string `'T123'` → `true`;
    - `'t123'` → `false`;
    - `['T999','T123']` → `true`;
    - `['T999']` → `false`;
    - missing → `false`;
    - the number `123` with the value `'123'` → `false`;
    - `null` → `false`;
    - an object `{ id: 'T123' }` → `false`.
  - `oidc-user.service.spec.ts`. The fixtures give `OidcIdentity` a `claims`
    object, and `OidcSettings` a `requiredClaim`:
    - `AC-AUTH-003.27: creates an ordinary user for a new email that carries the
      required claim`. Automatic registration is `false`. Expect `ok: true`,
      `user.role === 'user'`, and `automatic_registration` still `false`.
    - `AC-AUTH-003.27: refuses a login without the required claim`. Expect `{
      ok: false, reason: 'claim-mismatch' }` and no user row.
    - `refuses an existing linked user without the required claim`. Expect
      `claim-mismatch`.
    - `AC-AUTH-001.17: refuses the pending administrator without the required
      claim`. With state `oidc-pending` and a matching email but a wrong claim,
      expect `claim-mismatch`, and onboarding stays `oidc-pending`.
    - `AC-AUTH-003.28: without a required claim, a new email is still refused`.
      Expect `registration-disabled`.
    - `checks the verified email before the claim`. With an unverified email and
      a wrong claim, expect `email-not-verified`.
- [ ] **Step 2: Run them and check they fail.** `npx nx test
      server-feature-auth` fails on the new tests.
- [ ] **Step 3: Implement.**
  - `matchesRequiredClaim`.
  - In `resolve()`, right after the verified-email check: if
    `settings.requiredClaim` is set and does not match, return `{ ok: false,
    reason: 'claim-mismatch' }`.
  - Pass `claimMatched: boolean` into `findOrCreate(identity, claimMatched)`. It
    replaces `!automaticRegistration` with `!(automaticRegistration ||
    claimMatched)`. The existing `byEmail` guard stays.
  - Update the class doc comment to cite LG-69 to LG-71.
- [ ] **Step 4: Add the server e2e tests** in `oidc.e2e.spec.ts`, using
      `oidcEnv` and `provider.setClaims`:
  - `AC-AUTH-003.27: with a required claim, a matching new email gets an
    ordinary user and others are refused`.
    1. Start with `FRONT_BURNER_OIDC_REQUIRED_CLAIM_NAME:
       'https://slack.com/team_id'` and `..._VALUE: 'T123'`.
    2. The admin logs in with claim `T123`.
    3. Set claims `{ sub: 'subject-2', email: 'tester@example.com',
       'https://slack.com/team_id': 'T123' }` and log in. Expect a user row with
       role `user`.
    4. Set `sub: 'subject-3'`, `email: 'other@example.com'` and claim `T999`,
       and log in. Expect a redirect to `/login?oidcError=failed`, the last
       audit reason `claim-mismatch`, and no row for that email.
  - `AC-AUTH-001.17: refuses the administrator without the required claim while
    pending`. Expect a redirect to `/login?oidcError=claim-mismatch` and no user
    rows.
  - `AC-AUTH-001.16: refuses to start with only a required claim name`. Use
    `runServerToExit`, and check that the output names
    `FRONT_BURNER_OIDC_REQUIRED_CLAIM_VALUE`.

  Follow the login helper the existing AC-AUTH-001.11 test uses.
- [ ] **Step 5: Run the checks and make sure they pass.** `npx nx run-many -t
      test,typecheck,lint -p server-feature-auth shared-contracts
      server-core-database` and `npx nx e2e server-e2e` pass.
- [ ] **Step 6: Commit.** `feat(auth): enforce the OIDC required claim at login`

### Task 4: Onboarding form and messages

**Files:**

- Modify:
  `libs/web/feature-auth/src/auth/components/oidc-setup-step/oidc-setup-step.component.ts`
- Modify:
  `libs/web/feature-auth/src/auth/components/oidc-setup-step/oidc-setup-step.component.html`
- Test:
  `libs/web/feature-auth/src/auth/components/oidc-setup-step/oidc-setup-step.component.spec.ts`
- Modify: `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes:
  - `oidcSetupFields.requiredClaimName/Value` and `refineRequiredClaimPair`
    (Task 2);
  - the generated `saveOidcSetup` request with the two fields (Task 2);
  - `'claim-mismatch'` in `OidcFailureReason` (Task 3).

- [ ] **Step 1: Write failing component tests.**
  - `AC-AUTH-001.15: sends the required claim with the setup`. Fill both fields
    and submit, then expect `saveOidcSetup` to have been called with
    `requiredClaimName: 'https://slack.com/team_id', requiredClaimValue:
    'T123'`.
  - `AC-AUTH-001.15: pre-fills the required claim from a saved setup`.
  - `AC-AUTH-001.16: shows an error and blocks submit when only the claim name
    is filled`. Expect the text from
    `fieldErrors.requiredClaimValue.required-claim-pair`.
  - `AC-AUTH-001.17: shows the claim mismatch after a failed login`. With
    `failure = 'claim-mismatch'`, the banner shows that text.
- [ ] **Step 2: Run them and check they fail.** `npx nx test web-feature-auth`
      fails on the new tests.
- [ ] **Step 3: Implement.**
  - `SETUP_SCHEMA` becomes
    `z.object({...}).superRefine(refineRequiredClaimPair)`.
  - Add `requiredClaimName` and `requiredClaimValue` to `Setup`, `initialSetup`
    (`saved?.… ?? ''`), `KNOWN_CODES` (`[ 'too-big', 'required-claim-pair' ]`),
    `fieldErrors` and the request body.
  - Template: two `ui-field`s after the administrator email, each with
    `autocomplete="off"`. The name input has `code`. The name field's hint
    explains the Slack example and that the fields are temporary, and that
    leaving both empty disables the check.
  - i18n keys under `web-feature-auth.OidcSetupStepComponent.`:
    - `requiredClaimName`: "Required claim name (optional)";
    - `requiredClaimValue`: "Required claim value (optional)";
    - `requiredClaimHint`: "Only people whose ID token has this claim value can
      log in, and they get an account on their first login. For a Slack
      workspace, use https://slack.com/team_id and the workspace ID. Leave both
      empty to turn this off.";
    - `fieldErrors.requiredClaimName.required-claim-pair` and
      `fieldErrors.requiredClaimValue.required-claim-pair`: "Fill in both the
      claim name and the value, or leave both empty.";
    - `fieldErrors.requiredClaimName.too-big` and
      `fieldErrors.requiredClaimValue.too-big`: "Use at most 256 characters.".
  - Add `web-feature-auth.oidcErrors.claim-mismatch`: "This OIDC account does
    not have the required claim value."
- [ ] **Step 4: Run the checks and make sure they pass.** `npx nx run-many -t
      test,lint,typecheck -p web-feature-auth web` passes. Also check the
      template against the `angular-templates` skill.
- [ ] **Step 5: Commit.** `feat(web): required claim fields on the OIDC
      onboarding form`

### Task 5: Documentation

**Files:**

- Modify: `docs/requirements/auth-onboarding.md`
- Modify: `docs/requirements/auth-login.md`
- Modify: `docs/product/mvp.md`
- Modify: `docs/wiki/deployment.md`
- Modify: `docs/architecture/data.md`

- [ ] **Step 1: Update REQ-AUTH-001.** Add a section `### Required claim
      (temporary, MVP)` after `### Security`. It opens with a note that the
      deferred OIDC allow-list and automatic registration toggle replace it.
      Points:
  - **AO-40**: the two optional form fields; both or neither (AO-21 form,
    pre-filled as AO-26).
  - **AO-41**: the two variables; separate from AO-30; win over the saved
    values, whatever the OIDC source; both or neither, or the backend refuses to
    start.
  - **AO-42**: while `oidc-pending`, the administrator must match too (before
    AO-27); a mismatch follows AO-26 / AO-34 with reason `claim-mismatch`.

  Add AC-AUTH-001.15 to AC-AUTH-001.17 with the wording of the test titles
  above.
- [ ] **Step 2: Update REQ-AUTH-003.** Add a section `### Required claim
      (temporary, MVP)` after `### OIDC login`, with the same note. Points:
  - **LG-69**: the matching rule (Global Constraints), checked at every OIDC
    login after LG-19, for new and existing users.
  - **LG-70**: a match with no user found creates an ordinary OIDC user,
    whatever automatic registration is set to.
  - **LG-71**: a mismatch fails with `claim-mismatch`, shown as LG-21.

  Add a `claim-mismatch` row to the LG-43 reason table, and a ", or the required
  claim does not match (LG-71)" bullet to LG-20. Add AC-AUTH-003.27 and
  AC-AUTH-003.28.
- [ ] **Step 3: Update `mvp.md`.**
  - Scope table: add AO-40 to AO-42, AC-AUTH-001.15 to AC-AUTH-001.17, LG-69 to
    LG-71 and AC-AUTH-003.27 to AC-AUTH-003.28 to the "In MVP" columns.
  - Add to the MVP notes: "Required claim is a temporary measure for testing
    with a limited group."
  - Add to the deferred "Users" row: "(the temporary required claim stands in
    until then)".
  - Implementation status: REQ-AUTH-001 and REQ-AUTH-003 stay **Done**, with
    this PR added to their PR column.
- [ ] **Step 4: Update the deployment guide.** Add both variables to the table
      in `deployment.md` (marked temporary), and a short section "Limiting OIDC
      to a Slack workspace". It covers:
  - issuer `https://slack.com`;
  - scopes `openid email profile`;
  - claim name `https://slack.com/team_id`;
  - where to find the workspace ID.
- [ ] **Step 5: Update `data.md`.** Mention the two `system_settings` columns.
- [ ] **Step 6: Check the IDs.** Run the doc ID check from the `ai-tools` skill.
      It reports no duplicate or missing IDs. Then run `npx dprint fmt` on the
      changed docs.
- [ ] **Step 7: Commit.** `docs: OIDC required claim as a temporary MVP measure`
