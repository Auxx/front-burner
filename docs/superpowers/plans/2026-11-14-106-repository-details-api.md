# Repository Details API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 106 of [the step 5 index](2026-11-14-00-roadmap-step-5.md): `GET
/repositories/:id/details` answers what the settings page shows that a list
entry does not: how the repository was cloned, its level, when it was added, and
the error record of plan 105.

**Architecture:** A separate endpoint rather than more fields on
`RepositorySummary`, so that the lists do not carry git's error text for every
repository _(plan's call)_. `RepositoryDetails` holds the summary as `summary`,
so that the page reads one response.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-manage.md` (RM-1, RM-9, RM-10, RM-16).

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- Fields: `summary`, `cloneMode`, `branch` (the cloned branch of a single-branch
  clone, else `null`), `gitLevel`, `addedAt` (`created_at`), `errorDetail`,
  `errorRequestId`. The last two are `null` outside the `error` status.
- The remote is the display form, as everywhere (DS-19); the remote URL with its
  user part never leaves the backend.

## Review Focus

- **A single-branch clone** answers its branch; a full clone answers `null` →
  test `answers the branch of a single-branch clone`.
- **Another user's repository** is a missing one → test `answers another user's
  repository like a missing one`.
- **No credentials** in `summary.remote`, also for an HTTPS remote added with a
  username → test `answers the remote without credentials`.

---

### Task 1: Details

**Files:**

- Create: `libs/shared/contracts/src/repositories/repository-details.schema.ts`
- Modify: `libs/shared/contracts/src/index.ts`,
  `libs/server/feature/repositories/src/repositories/repositories.controller.ts`
  (+ spec),
  `libs/server/feature/repositories/src/repositories/repositories.dto.ts`,
  `libs/server/feature/repositories/src/repositories/repository-queries.ts` (+
  spec), `apps/server-e2e/src/repositories.e2e.spec.ts`,
  `docs/architecture/api.md`

**Interfaces:**

- Consumes: `repositories.errorDetail`, `repositories.errorRequestId` (plan
  105).
- Produces:
  - `RepositoryDetailsSchema` (id `RepositoryDetails`).
  - `toDetails(row: Repository): RepositoryDetails`.
  - `GET /api/v1/repositories/:id/details` (`details`, `200`).

- [ ] **Step 1: Write the failing tests**: `answers the clone mode, level and
      date added`; `answers the branch of a single-branch clone`; `answers the
      error record of a failed clone`; `answers no error record when ready`;
      `answers the remote without credentials`; `answers another user's
      repository like a missing one`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-repositories`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-003 adds `repository-details-api`.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repositories): a repository's
      details`.
