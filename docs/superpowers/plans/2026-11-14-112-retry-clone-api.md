# Retry Clone API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 112 of [the step 5 index](2026-11-14-00-roadmap-step-5.md): `POST
/repositories/:id/clone` clones a repository in the `error` status again, with
the same remote, clone mode and branch and its current credentials: **Retry
clone** after a failed clone (RM-11), **Clone again** after a damaged working
copy (RM-12).

**Architecture:** One endpoint for both, as the backend knows which applies from
the error code _(plan's call)_. It reuses what adding does after its access
check: the clone job, its per-user limit, and holding a protected key from the
session (`JobKeys`, RC-19). For a damaged working copy it first moves what is
left into `tmp/` and queues the delete job of plan 111.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-manage.md` (RM-2, RM-11 to RM-13,
AC-REPO-003.4, AC-REPO-003.5); `docs/requirements/repo-add.md` (AR-49 to AR-55);
`docs/requirements/repo-credentials.md` (RC-16, RC-19); NF-11.4.

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- Only the `error` status: any other answers `409 repository-not-in-error`
  (RM-2). A repository whose clone is queued or running is `cloning`, so two
  retries cannot clone twice.
- Limits as adding has them: the `access-check` rate limit group (AR-55) and the
  clone per-user limit (NF-11.4), with the same error codes (RM-13).
- A protected key locked in this session answers `409 key-locked` with the key,
  as the add request does, so that the web client unlocks and sends again
  (RC-16).
- The status becomes `cloning` and the error record of plan 105 is cleared in
  the same transaction that queues the job; `repository.status` is published.
- The clone job's payload carries this request's ID (plan 105).
- Kept: the name, credentials, commit author override, last access time and date
  added (RM-12). Cleared: the repository's `sync_state` row, which describes the
  old working copy _(plan's call)_.
- A working copy left by a failed clone is not expected (the engine clones into
  `tmp/` and moves it at the end); if one is there, it is trashed as for a
  damaged one.

## Review Focus

- **Clone again** keeps the override and the last access time → test `keeps the
  name, override and last access time`.
- **What is left of a damaged working copy** is gone before the clone moves the
  new one into place → test `trashes the old working copy first`.
- **Two quick retries** queue one clone → test `a second retry is refused while
  cloning`.
- **A locked key** is reported, not cloned without it → test `asks for the key
  when it is locked`.
- **A recorded merge** of the old working copy does not survive → test `forgets
  the old sync state`.

---

### Task 1: Cloning again

**Files:**

- Create: `libs/server/feature/repositories/src/clone/clone-again.service.ts` (+
  spec)
- Modify: `libs/server/feature/repositories/src/add/add-repository.service.ts`
  (what both share, + spec),
  `libs/server/feature/repositories/src/repositories/repositories.controller.ts`
  (+ spec), `libs/server/feature/repositories/src/repositories.module.ts`,
  `libs/shared/contracts/src/errors/error-codes.ts`,
  `apps/server-e2e/src/repositories.e2e.spec.ts`, `docs/architecture/api.md`,
  `docs/product/mvp.md`

**Interfaces:**

- Consumes: `CloneJob`, `JobKeys`, the delete job of plan 111.
- Produces: `POST /api/v1/repositories/:id/clone` (`cloneAgain`, `200`, the
  `RepositorySummary` in `cloning`); `409 repository-not-in-error`.

- [ ] **Step 1: Write the failing tests**: `retries a failed clone with the same
      settings`; `retries a timed out clone`; `uses the credentials changed
      since`; `trashes the old working copy first`; `keeps the name, override
      and last access time`; `forgets the old sync state`; `a second retry is
      refused while cloning`; `refuses a ready repository`; `asks for the key
      when it is locked`; `counts towards the clone limit`; `counts towards the
      access check limit`; `publishes repository.status`; `answers another
      user's repository like a missing one`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-repositories`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-003 adds `retry-clone-api`.
      AC-REPO-003.4 and .5 are plan 117's.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repositories): clone a repository
      again`.
