# Damaged Working Copy at Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 109 of [the step 5 index](2026-11-14-00-roadmap-step-5.md): when
a git operation finds the working copy unusable while the backend runs, the
repository gets the status Error, "Working copy is missing or damaged", as it
does on start (RM-6).

**Architecture:** The check is on the error path only, so that a working request
pays nothing _(plan's call)_: the engine maps git's "not a git repository" (and
a working copy folder that is gone, `ENOENT` on its `cwd`) to a
`GitOperationError` with the new code `working-copy-missing`. One service,
`WorkingCopyDamage`, marks the repository damaged with git's message (plan 105's
`markDamaged(id, detail)`) and publishes `repository.status`; the features'
exception mapping calls it and answers `409 working-copy-missing`, and jobs call
it before reporting their `failed` outcome.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-manage.md` (RM-6, AC-REPO-003.5);
`docs/requirements/file-browser.md` (FB-3); `docs/architecture/git-engine.md`.

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- Only a working copy that is really gone or not a repository counts. A git
  error of any other kind, such as a lock file or a timeout, is not damage:
  marking a working copy damaged sends the user to **Clone again**, which loses
  work (RM-12).
- A file request (the `files` feature) whose working copy root is gone counts
  too; a missing file inside it does not.
- The repository screen already shows a repository that is not `ready` as not
  openable (FB-3); it reacts to `repository.status` (check, and add if not).
- `docs/architecture/git-engine.md` names the new code with the others.

## Review Focus

- **A `.git` deleted while the backend runs:** the next status read marks the
  repository damaged → test `a status read on a working copy without .git marks
  it damaged`.
- **A lock file or timeout** never marks it damaged → test `other git errors
  leave the status alone`.
- **A missing file** is a `404`, not damage → test `a missing file is not
  damage`.
- **The open repository screen** leaves the editor once the status changes →
  test `the screen shows the repository as not openable`.

---

### Task 1: Finding damage

**Files:**

- Modify: `libs/server/core/git/src/` (the error mapping, + spec),
  `libs/server/feature/repositories/src/repositories/instance-repositories.ts`,
  the exception mapping of `server/feature/sync` and `server/feature/files` (+
  specs), `libs/shared/contracts/src/errors/error-codes.ts`,
  `apps/server-e2e/src/git.e2e.spec.ts`, `docs/architecture/git-engine.md`

**Interfaces:**

- Produces: the error code `working-copy-missing` (`409`); a
  `WorkingCopyDamage.report(userId, repositoryId, detail)` that marks and
  publishes once.

- [ ] **Step 1: Write the failing tests**: `a status read on a working copy
      without .git marks it damaged`; `a deleted working copy folder marks it
      damaged`; `a background fetch marks it damaged`; `other git errors leave
      the status alone`; `a missing file is not damage`; `publishes
      repository.status once`; `records git's message as the detail`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-core-git server-feature-sync server-feature-files`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [ ] **Step 5: Commit** — `feat(repositories): find a damaged working copy at
      work`

---

### Task 2: The repository screen

**Files:**

- Modify:
  `libs/web/feature-repository-screen/src/repository-screen/services/repository-session/repository-session.service.ts`
  (+ spec), `apps/web/public/i18n/en.json`,
  `apps/web-e2e/src/repository-screen.spec.ts`, `docs/product/mvp.md`

- [ ] **Step 1: Write the failing tests**: `the screen shows the repository as
      not openable`; `working-copy-missing from any request has its message`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-003 adds `damaged-at-work`. Leave
      AC-REPO-003.5 to plan 117.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repository-screen): leave a damaged
      repository`.
