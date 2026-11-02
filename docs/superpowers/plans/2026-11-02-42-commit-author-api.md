# Commit Author API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 42 of [the step 3 index](2026-11-02-00-roadmap-step-3.md): every
user has a default commit author and a stored confirmation, each repository can
override the author, and the API reads and changes them.

**Architecture:** A `user_preferences` table with one row per user, written when
the account is created and backfilled by the migration, plus two nullable
columns on `repositories`. A new `server/feature/preferences` library holds the
`CommitAuthors` service, which plan 52 asks for the author of a commit. The
rules of CA-10 are one Zod schema in `shared/contracts`, so that the web client
and the backend check the same way.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/commit-author.md` (REQ-GIT-001: CA-3 to CA-10,
CA-12's storage, CA-13's storage; criteria 1, 11; the API half of 7 and 12);
`docs/architecture/data.md` A-4.4.

## Global Constraints

- The shared constraints of [the step 3 index](2026-11-02-00-roadmap-step-3.md)
  apply.
- Name: trimmed, 1 to 255 characters, without `<`, `>` or a line break. Email:
  at most 254 characters, without `<`, `>`, spaces or a line break, with exactly
  one `@` and something on both sides. Any domain is allowed (CA-10).
- A repository override always has both a name and an email, or neither.
- Field errors use `ApiErrorException.forFields` paths `name` and `email`, with
  the codes `name-required`, `name-too-long`, `name-invalid`, `email-required`,
  `email-too-long`, `email-invalid` _(plan's call)_.

## Review Focus

- **`12345+user@users.noreply.github.com`, `me@nas`** must be accepted → Task 1
  test `accepts noreply and dotless addresses`.
- **`a@b@c` and `@nas` and `me@`** must be refused → Task 1 test `refuses an
  email without one @ between two parts`.
- **An instance created before this migration** must still have a default author
  → Task 2 test `the migration gives existing users a row`.
- **An OIDC user with only `preferred_username`, or only an email,** gets the
  next name in CA-7's order, never an empty one → Task 2 test `AC-GIT-001.1`.
- **Another user's repository ID on the override endpoints** is answered like a
  missing one → Task 3 test `AC-GIT-001.11`.
- **An account name that breaks CA-10** (`Carol <Ops>`) must not make the reads
  fail → Task 3 test `reads a stored default that breaks CA-10`; it is cleaned
  when copied, and a default that is still bad cannot be confirmed.

---

### Task 1: Contracts

**Files:**

- Create: `libs/shared/contracts/src/preferences/commit-author.schema.ts` (+
  `.spec.ts`)
- Modify: `libs/shared/contracts/src/index.ts`

**Interfaces:**

- Produces (each with `.meta({ id })`):
  - `CommitAuthorSchema`: `{ name, email }`, the rules above; `name` is trimmed.
  - `CommitAuthorPreferenceSchema`: `{ author: CommitAuthor, confirmed: boolean
    }`.
  - `RepositoryCommitAuthorSchema`: `{ author: CommitAuthor, source: 'default' |
    'override', confirmed: boolean }`.

- [ ] **Step 1: Write the failing tests**: `accepts noreply and dotless
      addresses`; `refuses a name with <, an email without @ and an email with a
      space`; `refuses an email without one @ between two parts`; `refuses a
      name of only spaces and a line break in either field`; `limits a name to
      255 and an email to 254 characters`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test shared-contracts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(contracts): commit author`

---

### Task 2: Tables and the default at account creation

**Files:**

- Create: `libs/server/core/database/src/schema/user-preferences.ts`, a
  generated migration `00NN_commit_author.sql`, reviewed by hand
- Modify: `libs/server/core/database/src/schema/repositories.ts`,
  `schema/index.ts`,
  `libs/server/feature/auth/src/onboarding/onboarding.service.ts`,
  `libs/server/feature/auth/src/oidc/oidc-user.service.ts`,
  `libs/server/feature/auth/src/oidc/oidc-login.service.ts`

**Interfaces:**

- Produces:
  - `userPreferences`: `userId` (primary key, `users.id`, `ON DELETE CASCADE`),
    `commitAuthorName`, `commitAuthorEmail` (not null), `commitAuthorConfirmed`
    (boolean, default false).
  - `repositories.commitAuthorName`, `repositories.commitAuthorEmail`, nullable.
  - `insertUserPreferences(tx: Tx, user: { id: number; displayName: string;
    email: string }): void` in `server/core/database`, called in the transaction
    that creates a user, at all three places that do.
- The migration ends with `INSERT INTO user_preferences (…) SELECT id,
  display_name, email, 0 FROM users;`.
- `oidc-login.service.ts` also passes `preferred_username`, so that
  `OidcUserService.newUser` follows CA-7: `name`, then `preferred_username`,
  then the part of the email before `@`.

- [ ] **Step 1: Write the failing tests**: `AC-GIT-001.1: a new password user's
      default is their display name and email`; `AC-GIT-001.1: a new OIDC user's
      is the name claim, then preferred_username, then the email's local part`;
      `the migration gives existing users a row`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-core-database server-feature-auth`.
- [ ] **Step 3: Implement**; `drizzle-kit generate`, then add the backfill to
      the generated file.
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(preferences): store the default commit author`

---

### Task 3: The preferences feature

**Files:**

- Create (generated with `@nx/nest:library`, tags `scope:server`,
  `type:feature`): `libs/server/feature/preferences`; in it
  `src/commit-author/commit-authors.ts`, `commit-author.controller.ts`,
  `commit-author.dto.ts` (+ specs)
- Modify: `apps/server/src/app/app.module.ts`, `apps/server-e2e/src/` (new
  `preferences.e2e.spec.ts`), `docs/product/mvp.md`

**Interfaces:**

- Consumes: `RepositoryQueries.find` (ownership), `DATABASE`.
- Produces:
  - `CommitAuthors`:
    - `preference(userId: number): CommitAuthorPreference`
    - `setDefault(userId: number, author: CommitAuthor):
      CommitAuthorPreference`: also confirms (CA-12).
    - `confirm(userId: number): void`
    - `forRepository(userId: number, repositoryId: number):
      RepositoryCommitAuthor`: CA-6; `404 not-found` for another user's.
    - `setOverride(userId, repositoryId, author): RepositoryCommitAuthor`: does
      not confirm; only editing the default counts (CA-12).
    - `removeOverride(userId, repositoryId): RepositoryCommitAuthor`.
  - Tag `preferences`, client class `PreferencesApi`; operation names in
    brackets: `GET /preferences/commit-author` (`commitAuthor`), `PUT`
    (`setCommitAuthor`), `POST /preferences/commit-author/confirm`
    (`confirmCommitAuthor`, `204`), `GET /repositories/:id/commit-author`
    (`repositoryCommitAuthor`), `PUT` (`setRepositoryCommitAuthor`) and `DELETE`
    (`removeRepositoryCommitAuthor`).

- [ ] **Step 1: Write the failing tests**: `setting the default confirms it`;
      `an override applies to its repository only, and removing it brings back
      the default`; `an override does not confirm`; over the API, `refuses a bad
      author next to the field`, and `AC-GIT-001.11: another user can neither
      read nor change a commit author`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-preferences`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`; add the texts
      of the new codes to `apps/web/public/i18n/en.json`.
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test -p
      server-feature-preferences server && npx nx e2e server-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-001 is **In progress**, Built in
      `commit-author-api`, points not built: CA-1, CA-2, CA-5, CA-9, CA-11,
      CA-12's question, CA-13's refusal, CA-14, CA-15. Run `doc-ids.mjs
      criteria` and copy its result.
- [ ] **Step 6: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; `npm run check:tags`; commit
      `feat(preferences): commit author API`.
