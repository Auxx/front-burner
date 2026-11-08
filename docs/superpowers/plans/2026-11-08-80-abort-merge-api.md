# Abort Merge API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 80 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): `POST
…/git/merge/abort` puts the branch, the files and the index back exactly as they
were before the pull.

**Architecture:** `git reset --hard <recorded commit>` rather than `git merge
--abort`: `merge --abort` fails with "Entry not uptodate" when a resolved file
differs from the index, whereas the working copy was clean before the pull
(GA-26), so going back to the commit is exact and cannot fail that way _(plan's
call)_. `MergeGuard` is the guard of every operation that only makes sense
during a merge, as `WorkingTreeGuard` is of those that do not.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-conflicts.md` (GC-23's backend half, GC-24,
GC-27); `docs/architecture/data.md` A-4.5a; D-4.5, D-4.6.

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- The commit to go back to is `sync_state.recorded_commit`, or else the ref.
  With neither, as after a restore that lost them, it is `git merge --abort`
  (A-5.12).
- It forgets the record and publishes `files.changed` with `folders: 'all'` and
  `git.changed`.

## Review Focus

- **Saved edits to a conflicting file, and resolved files,** must go too:
  "exactly as before" → Task 1 test `puts everything back after edits and
  resolutions`, which compares `git status`, `HEAD` and every file's hash with
  the state before the pull.
- **A file added by the merge** must be gone, not left as an untracked file →
  Task 1 test `removes what the merge added`.
- **A save queued behind the abort** must then be refused or apply to the clean
  file, never bring the merge's content back → Task 1 test `runs inside the
  lock`.
- **The record lost** must still end the merge → Task 1 test `aborts with git's
  own abort when no record is left`.
- **Two aborts at once, from two devices:** the second answers `409
  no-merge-in-progress`, and nothing else happens → Task 1 test `a second abort
  is refused`.

---

### Task 1: Aborting

**Files:**

- Create: `libs/server/feature/sync/src/merge/merge-guard.ts` (+ spec),
  `libs/server/feature/sync/src/merge/merge-actions.service.ts` (+ spec)
- Modify: `libs/server/core/git/src/engine/git-merge.ts` (+ spec),
  `libs/server/feature/sync/src/git/git.controller.ts` (+ spec),
  `libs/server/feature/sync/src/sync.module.ts`,
  `apps/server-e2e/src/git.e2e.spec.ts`, `docs/architecture/api.md`,
  `docs/product/mvp.md`

**Interfaces:**

- Consumes: `GitMerge.resetTo`, `GitMerge.forgetRecord`, `SyncStateStore`,
  `WorkingTreeLock`.
- Produces:
  - `MergeGuard.change<T>(repositoryId: number, root: string, task: () =>
    Promise<T>): Promise<T>`: inside the working-tree lock, refused with `409
    no-merge-in-progress` when there is none.
  - `GitMerge.abort(workingCopy: string): Promise<void>`: `git merge --abort`.
  - `MergeActions.abort(userId: number, repositoryId: number): Promise<void>`.
  - `POST /api/v1/repositories/:id/git/merge/abort` (`abortMerge`, `204`).

- [ ] **Step 1: Write the failing tests**: `puts everything back after edits and
      resolutions`; `removes what the merge added`; `forgets the record`; `shows
      the upstream's commits as to pull again` (GC-24); `aborts with git's own
      abort when no record is left`; `a second abort is refused`; `runs inside
      the lock`; `publishes files.changed and git.changed`; `answers another
      user's repository like a missing one`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-core-git server-feature-sync`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-003 is **In progress**, Built in
      `abort-merge-api`; points not built: all except GC-5 and GC-24. Run
      `doc-ids.mjs criteria` and copy its result. Name AC-GIT-003.12 in plan 96,
      where files can be resolved first.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(sync): abort a merge`.
