# Recovery on Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 78 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): on
start each working copy returns to a known state: stale locks gone, a merge cut
short undone, and a merge waiting for the user left alone.

**Architecture:** Merges make this urgent: until now, a crash could leave only
an `index.lock`, and now it can leave half a merge. `merge_applying` (plan 77)
says whether git was still merging when the backend stopped. If it was, the
working copy goes back to the recorded commit, whatever git left, as the merge
started clean (GA-26). If it was not, a `MERGE_HEAD` is a merge waiting for the
user. Recovery runs in `onApplicationBootstrap`, which Nest awaits before it
accepts requests, one working copy at a time.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/architecture/git-engine.md` A-5.14, A-5.15;
`docs/architecture/non-functional.md` NF-9.4, NF-9.5, NF-9.8;
`docs/requirements/git-conflicts.md` (GC-4).

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- `git update-index -q --refresh`, under `FRONT_BURNER_GIT_TIMEOUT`. A refresh
  that fails is logged and stops nothing (A-5.15); nor does a working copy that
  fails in any other way stop the others.
- Only `ready` repositories whose working copy exists: `WorkingCopyCheck` has
  dealt with the rest (RM-6).
- A reset is logged at `info`, with the repository ID and the commit.

## Review Focus

- **A waiting merge with resolutions made** must survive, with its markers,
  resolved files and the record → Task 1 test `leaves a merge waiting for the
  user alone`.
- **A crash between git finishing and `merge_applying` being cleared** finds a
  `MERGE_HEAD`, and undoes the merge, which the user can pull again: the safe
  side, as nothing was resolved yet → Task 1 test `undoes a merge whose flag is
  still set, even with MERGE_HEAD`.
- **An `index.lock` with a merge waiting** goes, and the merge stays, as nothing
  else uses the working copies (NF-9.4) → Task 1 test `removes a stale lock
  without ending a merge`.
- **A working copy that makes git fail** must not stop the start → Task 1 test
  `carries on after a working copy fails`.
- **An interrupted pull** ends failed, whatever order the job runner and
  recovery run in → Task 2 test `a restart during a merge leaves the branch as
  it was, and the job failed`.

---

### Task 1: Recovery

**Files:**

- Create: `libs/server/feature/sync/src/recovery/working-copy-recovery.ts` (+
  spec)
- Modify: `libs/server/core/git/src/engine/git-merge.ts` (+ spec),
  `libs/server/feature/sync/src/sync.module.ts`,
  `docs/architecture/git-engine.md`

**Interfaces:**

- Consumes: `SyncStateStore.record`, `GitMerge.resetTo`, `RepositoryQueries`,
  `DATA_LAYOUT`.
- Produces: `GitMerge.refreshIndex(workingCopy: string): Promise<void>` and
  `GitMerge.removeIndexLock(workingCopy: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**: `removes a stale lock without ending
      a merge`; `undoes a merge cut short`, with a half-written file and the
      branch moved; `undoes a merge whose flag is still set, even with
      MERGE_HEAD`; `leaves a merge waiting for the user alone`; `refreshes each
      index`; `carries on after a working copy fails`; `skips a repository that
      is not ready`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-core-git server-feature-sync`.
- [ ] **Step 3: Implement.** A-5.15 says how an interrupted merge is told from a
      waiting one. _(Plan's call.)_
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(sync): recover working copies on start`

---

### Task 2: End to end

**Files:**

- Modify: `apps/server-e2e/src/git.e2e.spec.ts`,
  `apps/server-e2e/src/startup.e2e.spec.ts`

- [ ] **Step 1: Write the tests**: `a restart during a merge leaves the branch
      as it was, and the job failed`, using the HTTP server's `delayMs` and a
      killed backend; `a restart keeps a merge waiting for the user`.
- [ ] **Step 2: Run them** — `npx nx e2e server-e2e`; all pass.
- [ ] **Step 3: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `test(sync): restarts during a merge`.
