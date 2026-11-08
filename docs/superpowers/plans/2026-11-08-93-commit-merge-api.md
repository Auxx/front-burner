# Commit Merge API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 93 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): `POST
…/git/merge/commit` commits the merge with the resolved files and what merged by
itself, as the user's commit author, and the merge ends.

**Architecture:** `GitEngine.commit` empties the index first and takes a list of
paths, which is wrong for a merge, whose index is the result. `GitMerge.commit`
runs `git commit` on the index as it stands, with `MERGE_HEAD` giving the second
parent. The record stays, with the merge commit beside it, so that plan 94 can
undo it (A-4.5a).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-conflicts.md` (GC-20's backend half, GC-21,
GC-27); `docs/requirements/commit-author.md` (CA-1, CA-2, CA-13, CA-14,
AC-GIT-001.9).

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- The command: `git -c commit.gpgsign=false commit --cleanup=whitespace
  --no-edit -F -`, with the message on standard input and the author in the
  environment (CA-2).
- It refuses, in this order, with `409`: `commit-author-not-confirmed` (CA-13),
  `no-merge-in-progress`, `merge-unresolved`. An empty message is a validation
  error (the schema's trim).
- It publishes `git.changed`. No file changes.

## Review Focus

- **A message with lines starting with `#`** keeps them, as the whole commit
  form does (GA-21) → Task 1 test `keeps a line starting with #`.
- **`user.name` in the working copy's config** is not used (CA-2) → Task 1 test
  `AC-GIT-001.9`, which also has the config set.
- **A failure of the commit,** such as a timeout, leaves the merge as it was
  (GC-27), and removes a stale `index.lock` → Task 1 test `leaves the merge
  after a failed commit`.
- **A file changed on disk but not in the index,** which plan 90 prevents, must
  not slip in → Task 1 test `commits the index as it stands`.
- **A merge whose result is the same as my commit,** after using my version
  everywhere, is still a merge commit with two parents → Task 1 test `commits a
  merge that changes nothing`.

---

### Task 1: Committing

**Files:**

- Modify: `libs/server/core/git/src/engine/git-merge.ts` (+ spec),
  `libs/shared/contracts/src/git/git-merge.schema.ts` (+ spec),
  `libs/shared/contracts/src/errors/error-codes.ts`,
  `libs/server/feature/sync/src/merge/merge-actions.service.ts` (+ spec),
  `libs/server/feature/sync/src/git/git.controller.ts` (+ spec),
  `libs/server/feature/sync/src/git/git.dto.ts`, `apps/web/public/i18n/en.json`,
  `apps/server-e2e/src/git.e2e.spec.ts`, `docs/product/mvp.md`

**Interfaces:**

- Consumes: `MergeGuard`, `CommitAuthors.forRepository`, `SyncStateStore`.
- Produces:
  - `GitMerge.commit(workingCopy: string, request: { message: string; author: {
    name: string; email: string } }): Promise<{ oid: string }>`.
  - `POST /api/v1/repositories/:id/git/merge/commit` (`commitMerge`, `201`,
    `GitMergeCommitRequest`: `{ message: string }`, `CommitResult`).
  - Error code `merge-unresolved`.

- [ ] **Step 1: Write the failing tests**: `commits with the resolved files and
      what merged by itself`; `has both parents`; `refuses an unconfirmed
      author`; `refuses while a file is unresolved`; `refuses without a merge`;
      `keeps a line starting with #`; `commits the index as it stands`; `commits
      a merge that changes nothing`; `leaves the merge after a failed commit`;
      `keeps the record, with the merge commit`; `publishes git.changed`; end to
      end, `AC-GIT-001.9: a merge commit made by a pull and the commit that
      finishes a conflict resolution use the same commit author as other commits
      in that repository`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-core-git server-feature-sync`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-003 adds `commit-merge-api`; GC-20
      and GC-21 "(only the backend is built)". REQ-GIT-001 adds it, and CA-14
      "(the question on the commit that finishes a merge, plan 101)". Run
      `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(sync): commit a merge`.
