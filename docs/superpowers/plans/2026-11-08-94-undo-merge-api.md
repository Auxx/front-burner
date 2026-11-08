# Undo Merge API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 94 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): the
status says whether the last merge can still be undone, `POST …/git/merge/undo`
undoes it, and the record is forgotten once the merge commit is pushed.

**Architecture:** GC-25's three conditions are checked by the backend, and when
asked again inside the lock, since a push from another tab can come between.
"Made by Front Burner" means that the last commit is `sync_state.merge_commit`.
A merge pushed from another device, or found on a remote branch by a fetch,
fails the condition without any bookkeeping; the record is then only forgotten
at the next push from here.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-conflicts.md` (GC-22, GC-25, GC-26's backend
half, GC-27); `docs/architecture/data.md` A-4.5a; D-4.6.

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- `undoableMerge` is true when: the last commit is `merge_commit`, it is on no
  remote branch (`git rev-list -1 <oid> --not --remotes`), and there are no
  changes.
- It refuses `409 undo-not-allowed` otherwise, and `409 merge-in-progress` from
  the guard.
- It goes back with `GitMerge.resetTo` to `recorded_commit`, forgets the record,
  and publishes `files.changed` with `folders: 'all'` and `git.changed`.
- A successful push forgets the record when `merge_commit` is then on a remote
  branch (A-4.5a).

## Review Focus

- **A commit on top of the merge,** then Undo: the last commit is no longer the
  merge, so it is refused, and that commit is not lost → Task 1 test `refuses
  after another commit`.
- **Uncommitted changes that appear between the status and the request** must
  refuse, since a hard reset would destroy them → Task 1 test `refuses with
  uncommitted changes, checked inside the lock`.
- **A failed push** keeps the record, as the merge can still be undone → Task 1
  test `keeps the record after a failed push`.
- **A second merge** replaces the record, so that Undo goes back one merge, not
  to before the first → Task 1 test `undoes only the last merge`.
- **A pull after a committed merge that changes nothing,** fails, or conflicts
  and is aborted, leaves that merge as the last commit, so Undo must still be
  offered (GC-25) → Task 1 test `stays offered after a pull that left the merge
  as it was`, for each.
- **A fast-forward after a merge** moves the branch so that the last commit is
  not the merge, and Undo is not offered → Task 1 test `is not offered after a
  fast-forward`.

---

### Task 1: Undoing

**Files:**

- Modify: `libs/server/core/git/src/engine/git-merge.ts` (+ spec),
  `libs/shared/contracts/src/git/git-status.schema.ts` (+ spec),
  `libs/shared/contracts/src/errors/error-codes.ts`,
  `libs/server/feature/sync/src/merge/merge-actions.service.ts` (+ spec),
  `libs/server/feature/sync/src/git/git.controller.ts` (+ spec),
  `libs/server/feature/sync/src/push/push.job.ts` (+ spec),
  `apps/web/public/i18n/en.json`, `apps/server-e2e/src/git.e2e.spec.ts`,
  `docs/product/mvp.md`

**Interfaces:**

- Consumes: `SyncStateStore.record`, `SyncStateStore.forgetRecord`,
  `GitMerge.resetTo`, `GitMerge.forgetRecord`, `WorkingTreeGuard.change`.
- Produces:
  - `GitMerge.isOnRemoteBranch(workingCopy: string, oid: string):
    Promise<boolean>`.
  - `GitStatus.undoableMerge: boolean`.
  - `POST /api/v1/repositories/:id/git/merge/undo` (`undoMerge`, `204`).
  - Error code `undo-not-allowed`.

- [ ] **Step 1: Write the failing tests**: `offers undo after a merge commit`;
      `is not offered after a pull that made no merge commit`; `is not offered
      after a fast-forward`; `stays offered after a pull that left the merge as
      it was`; `undoes the merge and shows the upstream's commits again`;
      `undoes only the last merge`; `refuses after another commit`; `refuses
      with uncommitted changes, checked inside the lock`; `refuses after a
      push`; `forgets the record after a successful push`; `keeps the record
      after a failed push`; `publishes files.changed and git.changed`; end to
      end, `undoes a committed merge over the API`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-core-git server-feature-sync`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-003 adds `undo-merge-api`; GC-25
      and GC-26 "(only the backend is built)". Run `doc-ids.mjs criteria` and
      copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(sync): undo a committed merge`.
