# Removal Check API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 110 of [the step 5 index](2026-11-14-00-roadmap-step-5.md): `GET
/repositories/:id/removal` says what removing the repository would lose, so that
the dialog can ask for one click or for the typed name (RM-18).

**Architecture:** A read-only engine call, `GitEngine.unsavedWork(root)`, runs
three git commands with `--no-optional-locks`, outside the working-tree lock
(the step 3 index): `git status --porcelain=v2 -z --untracked-files=all` for the
uncommitted files, `git rev-list --count HEAD --branches --not --remotes` for
the commits on no remote branch, and `MERGE_HEAD` for a merge. Plan 111 runs the
same check again inside the lock.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-manage.md` (RM-1, RM-17, RM-18,
AC-REPO-003.11); `docs/architecture/git-engine.md`.

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- Answer: `{ uncommittedFiles: number, unpushedCommits: number, mergeInProgress:
  boolean, unreadable: boolean }`. Work would be lost when any count is above 0,
  a merge is in progress, or `unreadable` is true.
- Ignored files are not counted: they are not work that git would keep either
  _(plan's call)_. Untracked files are.
- `HEAD` is counted as well as every branch, so that commits on a detached
  `HEAD` count. A branch with no commits yet (an empty remote) counts 0.
- A `cloning` repository, or one whose clone failed, has no work: zeros, without
  running git. A working copy that git cannot read (`working-copy-missing`, or a
  git failure here) answers `unreadable: true`, so that the user must type the
  name: nothing proves there is nothing to lose _(plan's call)_. Plan 109's
  damage marking is not triggered from here: a check never changes the status.
- A single-branch clone has only one remote branch: commits on other local
  branches count as not pushed, which is true.

## Review Focus

- **2 uncommitted files and 3 commits not pushed** answer exactly 2 and 3 → test
  `counts uncommitted files and commits not pushed`.
- **A new local branch never pushed** counts its commits → test `counts the
  commits of a branch that was never pushed`.
- **A detached `HEAD`** with a commit of its own counts it → test `counts
  commits on a detached HEAD`.
- **An unreadable working copy** asks for the name → test `an unreadable working
  copy is reported as such`.
- **Read-only:** no `index.lock` is taken → test `takes no lock`.

---

### Task 1: The check

**Files:**

- Create: `libs/shared/contracts/src/repositories/removal-check.schema.ts`,
  `libs/server/feature/repositories/src/remove/removal-check.ts` (+ spec)
- Modify: `libs/server/core/git/src/engine/git-engine.ts` (+ spec),
  `libs/shared/contracts/src/index.ts`,
  `libs/server/feature/repositories/src/repositories/repositories.controller.ts`
  (+ spec),
  `libs/server/feature/repositories/src/repositories/repositories.dto.ts`,
  `libs/server/feature/repositories/src/repositories.module.ts`,
  `apps/server-e2e/src/repositories.e2e.spec.ts`, `docs/architecture/api.md`,
  `docs/architecture/git-engine.md`

**Interfaces:**

- Produces:
  - `GitEngine.unsavedWork(workingCopy: string): Promise<{ uncommittedFiles:
    number; unpushedCommits: number; mergeInProgress: boolean }>`.
  - `RemovalCheck.of(userId: number, repositoryId: number):
    Promise<RemovalCheckResult>`; `wouldLoseWork(result): boolean`.
  - `GET /api/v1/repositories/:id/removal` (`removalCheck`, `200`).

- [ ] **Step 1: Write the failing tests**: `counts uncommitted files and commits
      not pushed`; `counts untracked files, not ignored ones`; `counts the
      commits of a branch that was never pushed`; `counts commits on a detached
      HEAD`; `reports a merge in progress`; `answers nothing to lose for a clean
      working copy`; `answers nothing to lose for a failed clone`; `an
      unreadable working copy is reported as such`; `takes no lock`; `answers
      another user's repository like a missing one`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-core-git server-feature-repositories`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-003 adds `removal-check-api`.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repositories): what removing would
      lose`.
