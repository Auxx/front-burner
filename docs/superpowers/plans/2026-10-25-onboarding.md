# Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull request 3 of the walking skeleton: a fresh instance sends every
URL to the Administrator onboarding page, where the operator enters the setup
token, chooses **username + password**, creates the first administrator and
lands on the login page, with onboarding closed for good.

**Architecture:** The password policy and the onboarding schemas live once in
`shared/contracts` and are used by both the backend's validation pipe and the
web client's Signal Forms. The backend gets its first tables (`users`,
`instance_state`) and its first feature library, `server/feature/auth`, whose
`OnboardingGuard` runs before validation so that a closed onboarding or a wrong
token is indistinguishable from an unknown route. The web client gets one
app-wide guard in `web/core` that routes by onboarding state, and the onboarding
page in `web/feature-auth`.

**Tech Stack:** as in the foundations plan, plus `argon2` 0.45.1 (backend) and
`@zxcvbn-ts/core` 4.2.0, `@zxcvbn-ts/language-common` 4.1.3,
`@zxcvbn-ts/language-en` 4.1.1 (web, lazily loaded). Angular Signal Forms
(`@angular/forms/signals`, 22.2.3, already installed).

**Spec:** `docs/superpowers/specs/2026-10-25-walking-skeleton-design.md`
(Delivery item 3, "Onboarding"; sections Database, Onboarding, Web client,
Tests). Requirements: `docs/requirements/auth-onboarding.md` (AO-1 to AO-20,
AO-37 to AO-39), `docs/requirements/auth-password-policy.md` (PP-1 to PP-15).
Architecture: `data.md` A-4.3, A-4.4; `api.md` A-3.8, A-3.9; `web-client.md`
A-8.3, A-8.6; `design-system.md` A-10.42; `non-functional.md` NF-10.5, NF-11.4,
NF-12.4, NF-13.8, NF-2.9.

## Global Constraints

- Branch `onboarding` (already created off `master`). `gh` is not installed;
  push only when the user asks, then hand them the pull request title and body.
- Load the `development-workflow` skill before the first edit. Angular artefacts
  (pages, components, services, directives) are created with the
  `@hexmode/toolkit-nx` generators (`toolkit-nx` skill); the server library with
  `@nx/nest:library`.
- **Exact versions** in `package.json`; every `@nx/*` package stays at
  **23.3.1**; all `@nestjs/*` on 11.x. New: `argon2` 0.45.1 (dependency),
  `@zxcvbn-ts/core` 4.2.0, `@zxcvbn-ts/language-common` 4.1.3,
  `@zxcvbn-ts/language-en` 4.1.1 (dependencies). Install with `npm install
  --save-exact`.
- Every new project has exactly one `scope:` and one `type:` tag; `npm run
  check:tags` passes. Import aliases are `@front-burner/<project-name>`.
- Server Vitest configs use `unplugin-swc` (copy
  `apps/server/vitest.config.mts`).
- No secret in a log, a response or browser storage: not the setup token, not a
  password, not part of one (AO-11, AO-38, PP-11). Email addresses only at
  `debug` (NF-10.5).
- Every onboarding `404` is a `NotFoundException` with no message, so that the
  global `ApiExceptionFilter` answers exactly as for an unknown route (AO-3).
- English UI text only through Transloco, keys in `apps/web/public/i18n/en.json`
  under `web-feature-auth.<Component>.<key>` (`web-core.<…>` for `web/core`).
- After any change to a controller or a contracts schema: `npx nx run
  web-api-client:generate` and commit `apps/server/openapi.json` and
  `libs/web/api-client/src/generated` (CI's drift check, A-3.7).
- Format with `npx dprint fmt`; `npx dprint check` passes.
- After editing a document under `docs/`, run the doc ID check from `ai-tools`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **A wrong token with an invalid body on a closed or tokenless instance** (`{
  "setupToken": "x" }` without the other fields) must get the unknown-route
  `404`, not `400 validation-failed`, which would reveal the endpoint → Task 5
  test `answers 404 before validating the body when the token is wrong` and Task
  6 test `a wrong token with an invalid body is indistinguishable from an
  unknown route`.
- **An email typed with a trailing space** (mobile keyboards add one after
  autocomplete) must be accepted and stored without it, and **the same email in
  another case** must hit the case-insensitive unique index, not create a second
  row → Task 1 test `trims the email` and Task 2 test `refuses a second user
  whose email differs only in case`.
- **A password submitted after the backend restarted with another token, or
  after onboarding was completed elsewhere** must not leave the page stuck: the
  page asks for the state again and either goes to `/login` or back to the token
  step with "invalid setup token" → Task 9 tests `goes to the login page when
  setup answers 404 and onboarding is completed` and `returns to the token step
  when setup answers 404 and onboarding is still required`.
- **The backend unreachable on first page load** (state request fails with a
  network error or `500`) must show an error with a retry on the onboarding
  page, not a blank screen or a silent redirect loop → Task 7 test `sends to
  onboarding with the error when the state request fails` and Task 9 test `shows
  the state error with a retry`.
- **A pasted setup token with a trailing newline or spaces** must not be
  silently changed: the token field sends exactly what was typed, and the
  backend compares it unchanged (a token copied from `echo` output fails
  visibly, with "invalid setup token") → Task 5 test `does not trim the setup
  token`.

---

### Task 1: Password policy and onboarding contracts

**Files:**

- Create: `libs/shared/contracts/src/auth/password-policy.ts` (+ `.spec.ts`)
- Create: `libs/shared/contracts/src/onboarding/onboarding.schema.ts` (+
  `.spec.ts`)
- Modify: `libs/shared/contracts/src/index.ts`

**Interfaces:**

- Produces (`password-policy.ts`):
  - `PASSWORD_RULES = ['too-short', 'too-long', 'too-few-classes',
    'control-character', 'equals-email'] as const`; `type PasswordRule`.
  - `PASSWORD_MIN_LENGTH = 10`, `PASSWORD_MAX_LENGTH = 256`.
  - `passwordPolicyIssues(password: string, email?: string): PasswordRule[]` —
    normalises to NFC first (PP-1), never trims (PP-2), counts code points
    (PP-8), returns every failed rule in `PASSWORD_RULES` order. Classes by
    `\p{Ll}`, `\p{Lu}`, `\p{Lo}`, `\p{Nd}`, everything else "other"; `\p{Cc}`
    fails `control-character` (and still counts towards no class).
    `equals-email` only when `email` is given; compared with `toLowerCase()` on
    both NFC forms.
  - `PasswordSchema`: `z.string().superRefine(...)` adding one issue per failed
    rule of PP-3 to PP-6: `{ code: 'custom', message: 'Password does not meet
    the policy', params: { code: <rule> } }`. The `ApiExceptionFilter` turns
    `params.code` into the field code; the message is fixed text (PP-11).
  - `refinePasswordNotEmail(value: { email: string; password: string }, ctx)` —
    the object-level check for `equals-email`, issue at `path: ['password']`,
    same shape as above.
- Produces (`onboarding.schema.ts`):
  - `ONBOARDING_STATES = ['required', 'oidc-pending', 'completed'] as const`;
    `type OnboardingState`.
  - `OnboardingStatusSchema` (`id: 'OnboardingStatus'`): `{ state:
    OnboardingState; oidcFromEnvironment: boolean; setupTokenConfigured: boolean
    }`.
  - `SetupTokenRequestSchema` (`id: 'SetupTokenRequest'`): `{ setupToken:
    z.string().min(1) }` — no trim.
  - `passwordSetupFields = { email: z.string().trim().pipe(z.email().max(254)),
    displayName: z.string().trim().min(1).max(100), password: PasswordSchema }`
    _(plan's call: lengths 254 and 100)_.
  - `PasswordSetupRequestSchema` (`id: 'PasswordSetupRequest'`): `z.object({
    setupToken: z.string().min(1), ...passwordSetupFields
    }).superRefine(refinePasswordNotEmail)`. Zod 4 cannot `.extend()` a refined
    object, so the web form builds its own object from `passwordSetupFields`.
  - Types `OnboardingStatus`, `SetupTokenRequest`, `PasswordSetupRequest`.

- [ ] **Step 1: Write the failing tests**

`password-policy.spec.ts`, one `it` per REQ-AUTH-002 criterion, asserting
`passwordPolicyIssues` exactly (`toEqual`):

```ts
it('AC1 one class', () => expect(passwordPolicyIssues('abcdefghij')).toEqual([ 'too-few-classes' ]));
it('AC2 two classes', () => expect(passwordPolicyIssues('abcdefghi1')).toEqual([]));
it('AC3 nine characters', () => expect(passwordPolicyIssues('Abcdefgh1')).toEqual([ 'too-short' ]));
it('AC4 Cyrillic and a space', () => expect(passwordPolicyIssues('пароль пароль')).toEqual([]));
it('AC5 caseless letters', () => {
  expect(passwordPolicyIssues('密码密码密码密码密码')).toEqual([ 'too-few-classes' ]);
  expect(passwordPolicyIssues('密码密码密码密码12')).toEqual([]);
});
it('AC6 256 and 257 characters', () => {
  const ok = 'a1'.repeat(128);
  expect(passwordPolicyIssues(ok)).toEqual([]);
  expect(passwordPolicyIssues(`${ok}b`)).toEqual([ 'too-long' ]);
});
it('AC7 tab', () => expect(passwordPolicyIssues('abcde\tfghi1')).toEqual([ 'control-character' ]));
it('AC8 equals the email ignoring case', () =>
  expect(passwordPolicyIssues('alice@example.com', 'Alice@Example.com')).toEqual([ 'equals-email' ]));
it('AC9 every failed rule', () => expect(passwordPolicyIssues('abc')).toEqual([ 'too-short', 'too-few-classes' ]));
it('AC10 NFD counts as NFC', () => expect(passwordPolicyIssues('café crème')).toEqual([]));
it('AC11 is never trimmed', () => expect(passwordPolicyIssues('  abcdefghi1  ')).toEqual([]));
```

Plus: `PasswordSchema` on `'abc'` gives two issues with `params.code`
`too-short` and `too-few-classes`, and no issue message or field contains
`'abc'`.

`onboarding.schema.spec.ts`: `trims the email` (`' a@b.co '` parses to
`'a@b.co'`); `does not trim the setup token`; a `PasswordSetupRequest` with
`password === email` (other case) fails with one issue at `['password']`,
`params.code === 'equals-email'`; each schema's `z.globalRegistry.get(...)?.id`
is its name; `OnboardingStatusSchema` refuses an unknown state.

- [ ] **Step 2: Run them and see them fail**

Run: `npx nx test shared-contracts` Expected: FAIL, modules not found.

- [ ] **Step 3: Implement both files and export them from `index.ts`**

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx nx test shared-contracts && npx nx lint shared-contracts` Expected:
PASS.

- [ ] **Step 5: Commit** — `feat(contracts): add password policy and onboarding
      schemas`

---

### Task 2: `users` and `instance_state` tables

**Files:**

- Create: `libs/server/core/database/src/schema/users.ts`
- Create: `libs/server/core/database/src/schema/instance-state.ts`
- Modify: `libs/server/core/database/src/schema/index.ts` (export both, keep the
  comment)
- Create (generated): `libs/server/core/database/migrations/0000_*.sql`,
  `migrations/meta/*`
- Test: `libs/server/core/database/src/schema/schema.spec.ts`

**Interfaces:**

- Produces:
  - `users` (`sqliteTable('users')`): `id` integer primary key autoincrement;
    `email` text not null; `displayName` (`display_name`) text not null; `role`
    text `{ enum: ['administrator', 'user'] }` not null; `loginMethod`
    (`login_method`) text `{ enum: ['password', 'oidc'] }` not null;
    `passwordHash` (`password_hash`) text, nullable (OIDC users have none);
    `createdAt` (`created_at`) integer `{ mode: 'timestamp_ms' }` not null.
    Unique index `users_email_lower_unique` on `lower(email)`. OIDC issuer +
    `sub`, the disabled flag and allowed levels come later as nullable or
    defaulted columns, so no row is rewritten (A-4.4).
  - `instanceState` (`instance_state`): `id` integer primary key with a check
    `id = 1`; `onboardingState` (`onboarding_state`) text `{ enum:
    ONBOARDING_STATES }` not null. Pending administrator email comes with OIDC.
  - Types `User = typeof users.$inferSelect`, `NewUser`.

- [ ] **Step 1: Write the failing test** — opens a temp database with
      `openDatabase`, `applyMigrations(database, MIGRATIONS_DIR)` (resolved from
      the workspace root), then:
  - `creates both tables` (rows can be inserted and read back through
    `database.db`);
  - `refuses a second user whose email differs only in case` (`Alice@x.io` then
    `alice@X.io` throws `SQLITE_CONSTRAINT_UNIQUE`);
  - `allows only one instance_state row` (inserting `id: 2` throws).
- [ ] **Step 2: Run it and see it fail** — `npx nx test server-core-database`;
      FAIL, `users` not exported.
- [ ] **Step 3: Define the tables, then generate the migration** — `npx nx run
      server-core-database:db-generate`, name the migration `0000_onboarding`
      (`--name onboarding` through the target's args if needed). Commit the SQL
      and `meta/` unedited.
- [ ] **Step 4: Run the tests and see them pass** — `npx nx test
      server-core-database && npx nx test server` (the startup tests now apply a
      real migration). Expected: PASS.
- [ ] **Step 5: Commit** — `feat(database): add users and instance_state tables`

---

### Task 3: Constant-time comparison and rate-limit groups

**Files:**

- Create: `libs/server/core/security/src/compare/constant-time-equals.ts` (+
  `.spec.ts`)
- Create:
  `libs/server/core/security/src/rate-limit/rate-limit-group.decorator.ts`
- Modify: `libs/server/core/security/src/rate-limit/rate-limit.module.ts`,
  `throttler.guard.ts` (+ `throttler.guard.spec.ts`), `src/index.ts`
- Modify: `docs/architecture/non-functional.md` NF-11.4 (one sentence: the
  onboarding endpoints that check the setup token share a limit of 10 requests
  per IP address per minute, which stays on after onboarding is completed)

**Interfaces:**

- Produces:
  - `constantTimeEquals(a: string, b: string): boolean` — SHA-256 of both UTF-8
    strings, then `timingSafeEqual`, so different lengths take the same time.
  - `RateLimitGroup(name: string)` — a decorator setting metadata
    `RATE_LIMIT_GROUP`. Every route of a group shares one counter per IP.
  - `RateLimitModule` throttlers: `default` (60/min, as now) and `group` (`{
    name: 'group', ttl: 60_000, limit: 10 }`). `AppThrottlerGuard` skips `group`
    on a handler without the metadata, and for `group` keys the counter by group
    name + tracker instead of controller + handler, so routes of one group count
    together. `setHeaders: false` stays.

- [ ] **Step 1: Write the failing tests**
  - `constantTimeEquals`: equal → `true`; differs in the last character, in
    length, or empty vs non-empty → `false`.
  - `throttler.guard.spec.ts` (a test module with two controllers, each with one
    `@RateLimitGroup('setup-token')` route and one plain route, through
    `supertest`): `routes of a group share 10 requests per minute` (5 + 5
    requests pass across both routes, the 11th gets 429 with `Retry-After`); `a
    route without a group keeps 60 per minute` (the plain route passes its 11th
    request).
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-core-security`.
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run them and see them pass** — `npx nx test server-core-security
      && npx nx lint server-core-security`.
- [ ] **Step 5: Commit** — `feat(security): add constant-time comparison and
      rate-limit groups`

---

### Task 4: `server-feature-auth` with password hashing and the onboarding state

**Files:**

- Create (generator): `libs/server/feature/auth/` — project
  `server-feature-auth`, tags `scope:server`, `type:feature`:

```bash
npx nx g @nx/nest:library --directory=libs/server/feature/auth --name=server-feature-auth --importPath=@front-burner/server-feature-auth --unitTestRunner=vitest --strict --tags=scope:server,type:feature --no-interactive
npm install --save-exact argon2@0.45.1
```

Delete the sample code; set up Vitest with `unplugin-swc` as the core libraries
do.

- Create: `src/passwords/password-hasher.ts` (+ `.spec.ts`)
- Create: `src/onboarding/onboarding-state.service.ts` (+ `.spec.ts`)
- Create: `src/testing/test-database.ts` — `createTestDatabase(): Database`, a
  migrated database in a temp directory, for this library's specs.

**Interfaces:**

- Consumes: `DATABASE`, `Database`, `users`, `instanceState` (Task 2); `CONFIG`,
  `Config`.
- Produces:
  - `PasswordHasher` (injectable): `hash(password: string): Promise<string>` —
    NFC first (PP-1), `argon2.hash(..., { type: argon2.argon2id })` with the
    library defaults otherwise; `verify(hash: string, password: string):
    Promise<boolean>` (NFC first; used by login later, tested now for AC 10).
  - `OnboardingStateService` (injectable, `OnModuleInit`):
    - `onModuleInit()` — startup step 5 (AO-1): inside one transaction, creates
      the `instance_state` row if missing and sets it to `completed` when a user
      exists, otherwise keeps it or sets `required`; logs `Administrator
      onboarding state: <state>` at `info`.
    - `current(): OnboardingState` — reads the row on every call (sub-
      millisecond, A-4.2) so it is always up to date.
    - `status(): OnboardingStatus` — `{ state, oidcFromEnvironment: false,
      setupTokenConfigured: config.setupToken !== undefined }`.

- [ ] **Step 1: Write the failing tests**
  - `PasswordHasher`: `stores an Argon2id hash` (starts with `$argon2id$`,
    REQ-AUTH-002 AC 12); `uses a fresh salt` (two hashes of one password
    differ); `verifies NFD against an NFC hash and the other way round` (AC 10);
    `does not trim` (hash of `'  abcdefghi1  '` does not verify `'abcdefghi1'`,
    AC 11).
  - `OnboardingStateService` on `createTestDatabase()`: `is required on an empty
    database`; `is completed when a user exists` (insert a user, then
    `onModuleInit`); `repairs a required row when a user exists`; `keeps a
    completed row` across a second `onModuleInit`; `status` reports
    `setupTokenConfigured` from the config.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-auth`.
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run them and see them pass** — `npx nx test server-feature-auth
      && npx nx lint server-feature-auth && npm run check:tags`.
- [ ] **Step 5: Commit** — `feat(auth): add server-feature-auth with password
      hashing and onboarding state`

---

### Task 5: Onboarding endpoints

**Files:**

- Create: `libs/server/feature/auth/src/onboarding/onboarding.guard.ts`
- Create: `.../onboarding/onboarding.service.ts` (+ `.spec.ts`)
- Create: `.../onboarding/onboarding.controller.ts` (+ `.spec.ts`)
- Create: `.../onboarding/onboarding.dto.ts`
- Create: `.../onboarding/onboarding.module.ts`; export it from `src/index.ts`
- Modify: `apps/server/src/app/app.module.ts` (import `OnboardingModule`)
- Regenerate: `apps/server/openapi.json`, `libs/web/api-client/src/generated/`
  (adds `Onboarding.ts`); add
  `libs/web/api-client/src/generated/Onboarding.spec.ts` following
  `Health.spec.ts`.

**Interfaces:**

- Consumes: Tasks 1–4; `ApiErrorException` is not used — every refusal is a bare
  `NotFoundException`.
- Produces — `@ApiTags('onboarding') @Controller('onboarding')` (under
  `api/v1`), all three routes with `@UseGuards(OnboardingGuard)`:

  | Method and path                             | Handler           | Body                   | Success                  | Group           |
  | ------------------------------------------- | ----------------- | ---------------------- | ------------------------ | --------------- |
  | `GET /api/v1/onboarding`                    | `status()`        | —                      | `200` `OnboardingStatus` | —               |
  | `POST /api/v1/onboarding/setup-token/check` | `checkSetupToken` | `SetupTokenRequest`    | `204`                    | `'setup-token'` |
  | `POST /api/v1/onboarding/password-setup`    | `setUpPassword`   | `PasswordSetupRequest` | `204`                    | `'setup-token'` |

  The generated client is then `OnboardingApi` with `status():
  Observable<OnboardingStatus>`, `checkSetupToken(data: SetupTokenRequest):
  Observable<void>`, `setUpPassword(data: PasswordSetupRequest):
  Observable<void>` (method names follow the handlers; check the generated file
  and use its names in Tasks 7 and 9).
- DTOs follow `HealthStatusDto`'s comment: built from the shape without the id,
  with `@ApiSchema({ name })`. `PasswordSetupRequestDto` must re-apply
  `.superRefine(refinePasswordNotEmail)`; a shape copy alone drops it.
- `OnboardingGuard` (`CanActivate`; guards run after the throttler and before
  the validation pipe, which is the point): `404` when `current()` is
  `completed`; on `POST` routes also `404` when `config.setupToken` is
  undefined, or `req.body?.setupToken` is not a string, or
  `!constantTimeEquals(body.setupToken, config.setupToken)`. A rejected token
  logs `warn` `Setup token rejected` (AO-39), with no token.
- `OnboardingService.setUpPassword(request: PasswordSetupRequest):
  Promise<void>` — hashes first (async, outside the transaction), then one
  synchronous transaction: `UPDATE instance_state SET onboarding_state =
  'completed' WHERE id = 1 AND onboarding_state = 'required'`; zero changed rows
  → throw `NotFoundException` (AO-6); else insert the administrator (`role:
  'administrator'`, `loginMethod: 'password'`). Logs `info` `Administrator
  onboarding completed`, and the email at `debug` only.
- `checkSetupToken` logs `info` `Administrator onboarding started` (AO-39).

- [ ] **Step 1: Write the failing tests**

`onboarding.controller.spec.ts` builds the real `AppModule` pieces it needs
(`ConfigModule`, `DatabaseModule` on `createTestDatabase()`, `RateLimitModule`,
`OnboardingModule`, the global filter and pipe) with `setGlobalPrefix('api/v1')`
and the JSON body parser, then uses `supertest`:

- `status answers required with setupTokenConfigured` (`{ state: 'required',
  oidcFromEnvironment: false, setupTokenConfigured: true }`).
- `check answers 204 for the right token and 404 for a wrong one`.
- `answers 404 before validating the body when the token is wrong` (`{
  setupToken: 'wrong' }` → 404 `not-found`, not 400).
- `does not trim the setup token` (the right token plus `'\n'` → 404).
- `every endpoint answers 404 when no token is configured` (POSTs) while
  `status` still answers with `setupTokenConfigured: false`.
- `password setup creates one administrator and completes onboarding` (204; one
  row with `role: 'administrator'`, `loginMethod: 'password'`, an `$argon2id$`
  hash; state `completed`; then `status` → 404).
- `a weak password lists every failed rule` (`abc` → 400 `validation-failed`,
  `fields` contains `{ path: 'password', code: 'too-short' }` and `{ path:
  'password', code: 'too-few-classes' }`; the body text does not contain `abc`).
- `refuses a password equal to the email` (`equals-email` at `password`).
- `no secret reaches the log` — run a rejected token and a successful setup with
  the log destination captured; it contains neither the token, the password nor
  the email at `info`.

`onboarding.service.spec.ts`:

- `of two concurrent setups exactly one succeeds` — `Promise.allSettled` of two
  `setUpPassword` calls with different emails: one fulfilled, one rejected with
  `NotFoundException`, one row in `users` (AC 13).

- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-auth`.
- [ ] **Step 3: Implement the guard, service, DTOs, controller and module;
      import the module in `AppModule`**
- [ ] **Step 4: Run them and see them pass** — `npx nx test server-feature-auth
      && npx nx test server && npx nx lint server-feature-auth`.
- [ ] **Step 5: Regenerate the OpenAPI document and the client** — `npx nx run
      web-api-client:generate`; write `Onboarding.spec.ts` like
      `Health.spec.ts`; `npx nx test web-api-client` passes (the
      contracts-imports check finds `OnboardingStatusSchema`,
      `SetupTokenRequestSchema`, `PasswordSetupRequestSchema`).
- [ ] **Step 6: Commit** — `feat(auth): add administrator onboarding endpoints`

---

### Task 6: Server e2e tests for onboarding

**Files:**

- Create: `apps/server-e2e/src/onboarding.e2e.spec.ts`
- Modify: `apps/server-e2e/src/support/server-process.ts` only if a helper is
  missing (for example a `countUsers(dataDir)` that opens `db/*.sqlite`
  read-only with `better-sqlite3` after `stop()`).

**Interfaces:**

- Consumes: `startServerProcess(env)`; endpoints of Task 5.
- `sameAsUnknownRoute(response, unknown)` helper in the spec: equal status,
  equal body apart from `requestId`, equal headers apart from `x-request-id`,
  `etag` and `date` _(plan's call: the ETag is a hash of a body that carries the
  request ID, so it differs between any two 404s, unknown routes included)_. The
  unknown route is the same method on `/api/v1/onboarding/nope`.

- [ ] **Step 1: Write the tests** (each starts its own server with
      `FRONT_BURNER_SETUP_TOKEN` set to a 32-character token unless the test
      says otherwise):
  - `AC2 without a token, data-changing requests answer 404` (and are
    `sameAsUnknownRoute`).
  - `AC3 a missing or wrong token answers 404 and changes nothing` (state still
    `required` afterwards).
  - `a wrong token with an invalid body is indistinguishable from an unknown
    route`.
  - `AC4 password setup completes onboarding` (204, then `GET
    /api/v1/onboarding` and both POSTs are `sameAsUnknownRoute`; after `stop()`,
    one user). "That user can log in" waits for REQ-AUTH-003.
  - `AC5 a policy-failing password is refused` (400, state still `required`).
  - `AC13 two simultaneous setups create one administrator` (statuses sorted
    `[204, 404]`; one user).
  - `AC14 a completed instance stays closed after a restart` (restart on the
    same data directory; every onboarding endpoint is `sameAsUnknownRoute`).
  - `the setup-token group is limited to 10 per minute` (11 checks alternating
    the two POSTs → the 11th is 429 with `Retry-After`), and `the limit stays on
    after onboarding is completed` (on a completed instance the 11th POST is
    still 429).
  - `a short token is ignored with a warning` (15 characters: the log has the
    warning, `setupTokenConfigured` is `false`).
- [ ] **Step 2: Run them** — `npx nx e2e server-e2e`. Expected: PASS (Task 5
      implemented the behaviour; a failure here is a bug to fix in Task 5's
      code).
- [ ] **Step 3: Commit** — `test(server-e2e): cover administrator onboarding`

---

### Task 7: Routing by onboarding state

**Files:**

- Create (toolkit-nx service generator):
  `libs/web/core/src/core/services/onboarding-state/onboarding-state.service.ts`
  (+ `.spec.ts`)
- Create: `libs/web/core/src/core/routing/onboarding.guard.ts` (+ `.spec.ts`) (a
  guard has no generator; follow the `toolkit-nx` skill for artefacts without
  one)
- Modify: `libs/web/core/src/index.ts`, `apps/web/src/app/app.routes.ts`,
  `libs/web/feature-auth/src/auth/auth.routes.ts`

**Interfaces:**

- Consumes: `OnboardingApi.status()` (Task 5), `toApiError`.
- Produces:
  - `type OnboardingView = { kind: 'status'; status: OnboardingStatus } | {
    kind: 'error'; error: ApiError }`.
  - `OnboardingStateService` (root): `load(): Promise<OnboardingView>` — asks
    once per page load and caches a `status`; a `404` becomes `{ kind: 'status',
    status: { state: 'completed', oidcFromEnvironment: false,
    setupTokenConfigured: false } }` (AO-3); any other failure is an `error` and
    is **not** cached. `refresh(): Promise<OnboardingView>` drops the cache.
    `markCompleted(): void` caches `completed` (after a successful setup, so
    `/login` opens without a reload). `view: Signal<OnboardingView | undefined>`
    mirrors the last result for the page.
  - `onboardingGuard: CanActivateChildFn` — target `/onboarding` vs anything
    else:

    | State                                        | `/onboarding` | other URL                                       |
    | -------------------------------------------- | ------------- | ----------------------------------------------- |
    | `required`                                   | allow         | → `/onboarding`                                 |
    | `oidc-pending`, `oidcFromEnvironment: false` | allow         | `/login` allowed, others → `/onboarding` (AO-2) |
    | `oidc-pending`, `oidcFromEnvironment: true`  | → `/login`    | allow (AO-33)                                   |
    | `completed`                                  | → `/login`    | allow                                           |
    | `error`                                      | allow         | → `/onboarding`                                 |

  - `app.routes.ts`: `[{ path: '', canActivateChild: [onboardingGuard],
    children: [{ path: '', loadChildren: authRoutes }, { path: '**', redirectTo:
    'login' }] }]`.
  - The `onboarding` route itself lands with its page in Task 9; this task's
    guard tests use their own routes in `RouterTestingHarness`.

- [ ] **Step 1: Write the failing tests** — service with
      `provideHttpClientTesting`: `asks the backend once` (two `load()` calls,
      one request); `treats 404 as completed`; `does not cache an error`;
      `markCompleted` makes `load()` answer `completed` without a request. Guard
      with `RouterTestingHarness` and a stubbed service: one test per table row,
      including `sends to onboarding with the error when the state request
      fails`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-core`.
- [ ] **Step 3: Implement; wire the routes**
- [ ] **Step 4: Run them and see them pass** — `npx nx test web-core && npx nx
      test web && npx nx lint web-core web`.
- [ ] **Step 5: Commit** — `feat(web): route by onboarding state`

---

### Task 8: Strength meter in `ui`

**Files:**

- Create (toolkit-nx component generator, library `ui`, category `feedback`):
  `libs/ui/src/feedback/components/strength-meter/strength-meter.component.{ts,html,scss,spec.ts,stories.ts}`
- Modify: `libs/ui/src/index.ts`

**Interfaces:**

- Produces: `StrengthMeterComponent`, selector `ui-strength-meter`:
  - `score = input.required<0 | 1 | 2 | 3 | 4 | null>()` (`null`: nothing to
    rate yet; shown empty);
  - `label = input.required<string>()` — the accessible name, for example
    "Password strength";
  - `valueText = input.required<string>()` — the visible and announced value,
    for example "Weak".
  - Renders `role="meter"` with `aria-valuemin="0"`, `aria-valuemax="4"`,
    `aria-valuenow` (absent when `null`), `aria-valuetext`, `aria-label`; four
    segments filled up to `score`, coloured by design tokens only (status danger
    for 0–1, warning for 2, success for 3–4; check with the `ai-tools` token and
    contrast tools that each fill reaches 3:1 against its track, WCAG 1.4.11).
    The meter is advisory (PP-14): no form semantics.
- Stories: `Empty`, one per score, `NarrowWidth` (320 px).

- [ ] **Step 1: Write the failing tests** — ARIA attributes per score;
      `aria-valuenow` absent for `null`; segments filled = score.
- [ ] **Step 2: Run them and see them fail** — `npx nx test ui`.
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run them and see them pass** — `npx nx test ui && npx nx lint
      ui`; build Storybook stories as the `ui` library's other components do and
      take a screenshot with the `ai-tools` Storybook tool in light and dark.
- [ ] **Step 5: Commit** — `feat(ui): add strength meter`

---

### Task 9: Onboarding page

**Files** (all under `libs/web/feature-auth/src/auth/`, created with the
toolkit-nx generators):

- Create: `pages/onboarding/onboarding.page.{ts,html,scss,spec.ts}`
- Create: `components/setup-token-step/…`, `components/login-method-step/…`,
  `components/password-setup-step/…`, `components/password-policy/…` (each
  `.ts,.html,.scss,.spec.ts`)
- Create: `services/password-strength/password-strength.service.ts` (+
  `.spec.ts`)
- Modify: `auth.routes.ts` (add `{ path: 'onboarding', component:
  OnboardingPage, title: 'web-feature-auth.OnboardingPage.title' }`),
  `apps/web/public/i18n/en.json`, `apps/web/src/app/app.html` (add
  `<ui-toast-outlet />` next to the router outlet) and `app.ts` imports
- `npm install --save-exact @zxcvbn-ts/core@4.2.0
  @zxcvbn-ts/language-common@4.1.3 @zxcvbn-ts/language-en@4.1.1`

**Interfaces:**

- Consumes: `OnboardingStateService`, `OnboardingApi`, `ApiErrorTextService`,
  `toApiError`; contracts `passwordSetupFields`, `refinePasswordNotEmail`,
  `passwordPolicyIssues`, `PASSWORD_RULES`; `ui` `FieldComponent`,
  `InputComponent`, `PasswordRevealDirective`, `IconButtonComponent`,
  `ButtonComponent`, `SegmentedControlComponent`, `InlineBannerComponent`,
  `IslandComponent`, `StrengthMeterComponent`, `ToastService`.
- Produces:
  - `OnboardingPage` (`auth-onboarding`): one `<main>` with an `<h1>` "Set up
    Front Burner"; holds `step = signal<'token' | 'method' |
    'password'>('token')` and `setupToken = signal('')` (memory only, AO-11).
    Shows, from `OnboardingStateService.view()`:
    - `error` → `ui-inline-banner` (error) with the `ApiErrorTextService` text,
      the reference and a **Try again** button calling `refresh()`;
    - `setupTokenConfigured: false` → the no-token explanation (AO-9), with
      `FRONT_BURNER_SETUP_TOKEN` in `<code>` and "restart Front Burner";
    - otherwise the current step.
  - `SetupTokenStepComponent`: one password-type field "Setup token" with a
    reveal button; submit calls `checkSetupToken`; `204` → emits
    `accepted(token)`; `404` → field error "This setup token isn't valid."
    (AO-10); other errors → banner text.
  - `LoginMethodStepComponent`: the AO-14 explanation; `ui-segmented-control`
    with **Username and password** and **OIDC** (`disabled: true`, hint "OIDC
    isn't available yet."); **Back** (to the token step) and **Continue**.
  - `PasswordSetupStepComponent`: Signal Forms `form()` on `{ email,
    displayName, password, passwordConfirmation }` with `validateStandardSchema`
    on `z.object({ ...passwordSetupFields, passwordConfirmation: z.string()
    }).superRefine(refinePasswordNotEmail)` plus a confirmation-matches check;
    errors shown once a field is touched or on submit; `<app-password-policy>`
    and `<ui-strength-meter>` under the password field (PP-13, PP-14); **Back**
    (AO-15) and **Create administrator**. Backend `fields` errors are shown on
    their fields by `path`. On `204`: `markCompleted()`, toast "Administrator
    account created. Log in with your email and password." and navigate to
    `/login` (AO-20). On `404`: `refresh()`; `completed` → `/login`; otherwise
    back to the token step with the invalid-token error.
  - `PasswordPolicyComponent` (`auth-password-policy`): `password` and `email`
    inputs; a list of the rules of `PASSWORD_RULES` (`too-long` and
    `control-character` listed only while they fail), each marked met or not met
    with an icon and visually hidden text.
  - `PasswordStrengthService.estimate(password: string, userInputs: string[]):
    Promise<0 | 1 | 2 | 3 | 4>` — `import()`s the three `@zxcvbn-ts` packages on
    first use (so they stay out of the initial bundle, NF-2.9), sets the options
    once, returns `zxcvbn(password, userInputs).score`. The step debounces calls
    by 150 ms and passes the email and display name as `userInputs`.
  - Strength texts: 0–1 "Weak", 2 "Fair", 3 "Good", 4 "Strong".
  - Field error texts by code under
    `web-feature-auth.PasswordSetupStep.errors.*` for `too-short`, `too-long`,
    `too-few-classes`, `control-character`, `equals-email`, `invalid-format`
    (email), `too-small` (empty), `too-big`, `mismatch` (confirmation); an
    unknown code shows the `errors.validation-failed` text.
  - Page title key `web-feature-auth.OnboardingPage.title` = "Set up Front
    Burner" (NV-13 adds " · Front Burner").

- [ ] **Step 1: Write the failing tests**
  - `OnboardingPage`: `shows the no-token explanation`; `shows the state error
    with a retry` (Try again calls `refresh()`); `walks token → method →
    password and back`; `goes to the login page when setup answers 404 and
    onboarding is completed`; `returns to the token step when setup answers 404
    and onboarding is still required`; `never writes to localStorage,
    sessionStorage or cookies` (spy on `Storage.prototype.setItem` and the
    `document.cookie` setter).
  - `SetupTokenStepComponent`: `shows invalid setup token on 404`; `emits the
    token unchanged on 204` (with a trailing space).
  - `PasswordSetupStepComponent`: `shows the backend's field errors on their
    fields`; `does not submit while the confirmation differs`; `on success marks
    onboarding completed, shows the toast and goes to /login`.
  - `PasswordPolicyComponent`: for `abc`, `too-short` and `too-few-classes` are
    not met and `equals-email` is met; `control-character` is listed only for a
    password with a tab.
  - `PasswordStrengthService`: `rates a long random password 3 or more and
    'password1234' 1 or less`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-feature-auth`.
- [ ] **Step 3: Implement the page, steps, policy list and service; add the
      translations and the toast outlet**
- [ ] **Step 4: Run them and see them pass** — `npx nx test web-feature-auth &&
      npx nx test web && npx nx lint web-feature-auth web && npx nx build web
      --configuration=production && node apps/web/scripts/size-check.mjs`
      (initial bundle within 300 KB gzipped; the `@zxcvbn-ts` code is in a lazy
      chunk).
- [ ] **Step 5: Commit** — `feat(web): add the administrator onboarding page`

---

### Task 10: Web e2e with an instance per test

**Files:**

- Create: `apps/web-e2e/src/support/instance.ts`
- Modify: `apps/web-e2e/src/support/fixtures.ts`,
  `apps/web-e2e/playwright.config.mts` (drop `webServer` and the fixed
  `baseURL`)
- Delete: `apps/web-e2e/start-server.mjs`
- Modify: `apps/web-e2e/src/login.spec.ts`
- Create: `apps/web-e2e/src/onboarding.spec.ts`

**Interfaces:**

- Produces:
  - `startInstance(options: { setupToken?: string; onboarded?: boolean }):
    Promise<{ url: string; stop(): Promise<void> }>` — spawns
    `dist/apps/server/main.js` from the workspace root on a free port with a
    fresh temp data directory, without the developer's `FRONT_BURNER_*`
    variables (as `start-server.mjs` did), waits for `/api/health/ready`; with
    `onboarded`, completes onboarding through the API with a fixed token and
    administrator. _(Plan's call: a completed onboarding cannot be undone, so
    one shared server cannot serve both the onboarding tests and the login
    tests, nor five browser projects running in parallel.)_
  - Fixtures: `instanceOptions` (test option, default `{ setupToken: TEST_TOKEN
    }`), `instance` (test-scoped, started from it and stopped after), and
    `baseURL` overridden with `instance.url`. `monitor` stays as is.
    `TEST_TOKEN` is exported, 32 characters.

- [ ] **Step 1: Write the instance helper and fixtures; move `login.spec.ts` to
      `test.use({ instanceOptions: { onboarded: true } })`** — its existing
      tests keep their assertions.
- [ ] **Step 2: Write `onboarding.spec.ts`**:
  - `AC1 any URL shows the onboarding page` for `/`, `/login`, `/no/such/page`
    (URL ends in `/onboarding`, `h1` "Set up Front Burner", title "Set up Front
    Burner · Front Burner").
  - `explains a missing setup token` (`instanceOptions: {}`): the text names
    `FRONT_BURNER_SETUP_TOKEN`.
  - `shows an invalid setup token`.
  - `happy path ends on the login page` — token, method, form (policy list and
    strength meter visible and updating while typing), submit; the toast is
    shown, the URL ends in `/login`; a reload of `/onboarding` lands on
    `/login`.
  - `has no accessibility violations` on each step and on the no-token page
    (axe, NF-13.8).
  - `does not scroll sideways at 320 px` on the password step (AO-7, NF-12.4).
  - The `monitor` fixture fails any test with a CSP or Trusted Types violation
    or a console error. The expected `404` of the invalid-token check logs a
    console error in some browsers; drain only that one, as the `fixture` tests
    do.
- [ ] **Step 3: Run them** — `npx nx e2e web-e2e` (all five projects). Expected:
      PASS.
- [ ] **Step 4: Commit** — `test(web-e2e): cover administrator onboarding with
      an instance per test`

---

### Task 11: Documentation and final check

**Files:**

- Modify: `docs/requirements/auth-onboarding.md` AO-5 — the state endpoint also
  says whether a valid setup token is set; it exposes no secrets.
- Modify: `docs/architecture/api.md` — under the API section, one line listing
  the three onboarding endpoints and that every refusal is the unknown-route
  `404` (AO-3, AO-10).
- Modify: `libs/server/feature/auth/README.md`,
  `libs/web/feature-auth/README.md` — what the library holds.
- Modify: the spec's Status stays **Draft** unless the user says otherwise.

- [ ] **Step 1: Edit the documents; run the `ai-tools` doc ID check**
- [ ] **Step 2: Full verification** — `npx nx run-many -t lint test build
      typecheck && npx nx e2e server-e2e && npx nx e2e web-e2e && npx nx run
      web-api-client:generate && git diff --exit-code apps/server/openapi.json
      libs/web/api-client/src/generated && npx dprint check && npm run
      check:tags`. Expected: everything passes and the drift check shows no
      diff.
- [ ] **Step 3: Manual check** — `nx serve server` (with
      `FRONT_BURNER_SETUP_TOKEN` in `.env`) and `nx serve web`: run the happy
      path once at desktop width and at 320 px.
- [ ] **Step 4: Commit** — `docs: record onboarding decisions`
- [ ] **Step 5: Hand over** — give the user the pull request title
      ("Administrator onboarding (#…)") and a body summarising the tasks, ending
      with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
