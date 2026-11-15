# Repository List API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 104 of [the step 5 index](2026-11-14-00-roadmap-step-5.md): `GET
/repositories` answers all of the user's repositories, in any status, sorted by
name ignoring case.

**Architecture:** One more query in `RepositoryQueries` and one more route in
`RepositoriesController`, answering the same `RepositorySummary` as the
dashboard. The list is not paged: a user is expected to have about 50
repositories (NF-1.3), so the schema has no `.max` _(plan's call)_. Adding does
not enforce that number.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-manage.md` (RM-1, RM-2, RM-5); DS-9.

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- Sorted by name ignoring case, then by ID, so that the order is stable. Names
  are compared in TypeScript with `compareRepositoryNames` of `shared-util`,
  since SQLite's `lower` folds ASCII only; the dashboard's ties use it too, and
  adding checks AR-15 with `sameRepositoryName` (A-3.2a) _(plan's call, after
  review)_.
- Listing changes nothing: no last access time (DS-9), no job.
- `GET /repositories` is declared before `GET /repositories/:id`, as `recent`
  and `index` are.

## Review Focus

- **Another user's repositories** must never be listed → test `lists only the
  user's own`.
- **Every status** is listed, including `cloning` and `error` → test `lists
  every status`.
- **Case:** `alpha`, `Beta`, `gamma` in that order, not `Beta` first → test
  `sorts by name ignoring case`.
- **Last access time** is not changed by listing → test `does not change the
  last access time`.

---

### Task 1: Listing

**Files:**

- Create: `libs/shared/contracts/src/repositories/repository-list.schema.ts`
- Modify: `libs/shared/contracts/src/index.ts`,
  `libs/server/feature/repositories/src/repositories/repository-queries.ts` (+
  spec),
  `libs/server/feature/repositories/src/repositories/repositories.controller.ts`
  (+ spec),
  `libs/server/feature/repositories/src/repositories/repositories.dto.ts`,
  `apps/server-e2e/src/repositories.e2e.spec.ts`, `docs/architecture/api.md`

**Interfaces:**

- Produces:
  - `RepositoryListSchema` (`{ repositories: RepositorySummary[] }`, id
    `RepositoryList`).
  - `RepositoryQueries.all(userId: number): Repository[]`.
  - `GET /api/v1/repositories` (`list`, `200`).

- [ ] **Step 1: Write the failing tests**: `sorts by name ignoring case`; `ties
      by ID`; `lists every status`; `lists only the user's own`; `does not
      change the last access time`; `answers an empty list for a user without
      repositories`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-repositories`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-003 adds `repository-list-api`. No
      criterion is named here: AC-REPO-003.1 is plan 114's.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repositories): list all
      repositories`.
