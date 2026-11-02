# Repository Credentials API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 62 of [the step 3 index](2026-11-02-00-roadmap-step-3.md): the
API replaces a repository's credentials after an access check, and updates saved
HTTPS credentials in place, which fixes every repository that uses them.

**Architecture:** The access check and "save new credentials" code of
`AddRepositoryService` moves, unchanged, into a `CredentialsCheck` service that
both the add flow and these endpoints call, so the errors are the same as on the
Add repository page (RC-8, AR-42). Everything changes in one transaction, after
the check passes, so that a failed check changes nothing.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-credentials.md` (RC-1, RC-2, RC-8, RC-10,
RC-12's count, RC-13, RC-14's backend half; criterion 6, the API for 5);
`libs/server/feature/repositories/src/add/add-repository.service.ts`;
`docs/architecture/data.md` A-4.8.

## Global Constraints

- The shared constraints of [the step 3 index](2026-11-02-00-roadmap-step-3.md)
  apply.
- The body of `PUT …/credentials` is the existing `RepositoryCredentials` union.
  A mode that does not fit the remote's protocol is refused with `credentials:
  kind-mismatch`, as when adding (RC-7).
- **Replacing never deletes** the old saved credentials (RC-10).
- Updating is only for saved HTTPS credentials, `409 credentials-not-updatable`
  otherwise (RC-14). The new secret is encrypted with the record's own binding
  (A-4.8), and the username may change (RC-12).
- Both endpoints use the rate-limit group `access-check`, as they contact the
  remote (AR-55).
- A passphrase given with a key unlocks it for the session, as when adding
  (AR-31).

## Review Focus

- **Another user's credential ID** in the body must be refused as not found, and
  must not say whether it exists → Task 2 test `refuses another user's saved
  credentials`.
- **Updating with a token that fails the check** must leave the stored secret
  byte for byte → Task 2 test `an update whose access check fails changes
  nothing`.
- **A new credential whose name is taken** must be refused before the remote is
  contacted, as on the Add repository page → Task 2 test `refuses a taken name
  before contacting the remote`.
- **A push running during a replace** uses what it read when it started, and the
  next one uses the new credentials → Task 2 test `a push after the update uses
  the new token`.
- **A repository that is still cloning** is refused → Task 2 test `refuses a
  repository that is not ready`.

---

### Task 1: Share the check

**Files:**

- Create: `libs/server/feature/repositories/src/add/credentials-check.ts` (+
  spec, moved tests)
- Modify: `libs/server/feature/repositories/src/add/add-repository.service.ts`
  (+ spec), `libs/server/feature/repositories/src/repositories.module.ts`

**Interfaces:**

- Produces: `CredentialsCheck`: `check(user, remoteUrl, remote, mode,
  credentials): Promise<AccessCheckResult>`, `assertNameFree(userId,
  credentials): void`, `saveNew(tx, userId, credentials): number | undefined`,
  with the bodies of today's private methods `check`, `assertCredentialNameFree`
  and `saveNewCredentials`.

- [ ] **Step 1: Run the add flow's tests first** — `npx nx test
      server-feature-repositories`; all pass.
- [ ] **Step 2: Move the methods**, with their tests; no assertion changes.
- [ ] **Step 3: Run them** — same command; all pass.
- [ ] **Step 4: Commit** — `refactor(repositories): share the credentials check`

---

### Task 2: Replace and update

**Files:**

- Modify:
  `libs/server/feature/repositories/src/credentials/repository-credentials.service.ts`,
  `repository-credentials.controller.ts` (+ specs),
  `libs/server/feature/credentials/src/saved/saved-credentials.service.ts` (+
  spec),
  `libs/shared/contracts/src/repositories/repository-credentials.schema.ts`,
  `libs/shared/contracts/src/errors/error-codes.ts`,
  `apps/web/public/i18n/en.json`, `apps/server-e2e/src/git.e2e.spec.ts`,
  `docs/product/mvp.md`

**Interfaces:**

- Consumes: `CredentialsCheck`, `RequestCredentials.resolve`,
  `RepositoryQueries.find`.
- Produces:
  - `PUT /api/v1/repositories/:id/credentials` (`replaceRepositoryCredentials`):
    answers `RepositoryCredentialsInfo`.
  - `PUT /api/v1/repositories/:id/credentials/token` (`updateRepositoryToken`),
    body `UpdateTokenRequest` (`{ username: string; password: string }`,
    `.meta({ id })`): answers `RepositoryCredentialsInfo`.
  - `SavedCredentialsService.replaceHttps(tx: Tx, userId: number, id: number,
    input: { username: string; password: string }): void`.

- [ ] **Step 1: Write the failing tests**: `uses new credentials after the check
      passes, and saves them`; `AC-REPO-002.6: replacing keeps the old saved
      credentials, and other repositories keep working`; `a failed check changes
      nothing`; `an update whose access check fails changes nothing`; `refuses
      to update an SSH key or a repository without credentials`; `refuses
      another user's saved credentials`; `refuses a taken name before contacting
      the remote`; `refuses a repository that is not ready`; `a push after the
      update uses the new token`; `no response contains the token`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-feature-repositories server-feature-credentials`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-002 adds
      `repository-credentials-api`; RC-8, RC-10 and RC-13 "(only the backend is
      built)". Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; commit `feat(repositories):
      replace credentials and update a saved token`.
