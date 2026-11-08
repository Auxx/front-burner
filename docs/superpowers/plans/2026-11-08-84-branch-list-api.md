# Branch List API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 84 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): `GET
…/git/branches` lists the local branches and the remote branches that have no
local branch.

**Architecture:** A new `GitBranches` class, using `LocalGit`, reads `git
for-each-ref` with an explicit format (A-5.1). Read-only, outside the
working-tree lock (A-5.3).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-advanced.md` (GA-36, GA-41, GA-42);
`docs/architecture/git-engine.md` A-5.10.

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- The format is `%(refname)%00%(upstream)%00%(symref)`, for `refs/heads` and
  `refs/remotes/origin`.
- `refs/remotes/origin/HEAD` is not a branch (it has a `%(symref)`). A remote
  branch is left out when a local branch has its name or tracks it (GA-36).
- Both lists are sorted by name, comparing code units, so that the order is the
  same on every device.

## Review Focus

- **A local branch that tracks a remote branch of another name** leaves that
  remote branch out → Task 1 test `leaves out a remote branch a local branch
  tracks`.
- **A repository with no commits** has a current branch and no ref: the list
  must still show `main` (GA-42) → Task 1 test `lists the current branch before
  the first commit`.
- **A detached `HEAD`** has no current branch to mark → Task 1 test `marks
  nothing on a detached HEAD`.
- **A name with slashes, non-ASCII letters, or that looks like an option** is
  one name → Task 1 test `reads every kind of branch name`.
- **A single-branch clone with a branch pushed from Front Burner** lists that
  branch as remote too (GA-41) → Task 2 test `lists what a single-branch clone
  has`.

---

### Task 1: The engine

**Files:**

- Create: `libs/server/core/git/src/engine/git-branches.ts` (+ spec)
- Modify: `libs/server/core/git/src/git.module.ts`,
  `libs/server/core/git/src/index.ts`

**Interfaces:**

- Produces: `GitBranches.list(workingCopy: string): Promise<BranchList>`, with
  `BranchList`: `{ current: string | null; local: { name: string; upstream:
  string | null }[]; remote: { name: string; branch: string }[] }`, where a
  remote's `name` is such as `origin/feature` and its `branch` is `feature`.

- [ ] **Step 1: Write the failing tests**: `lists local branches with their
      upstreams`; `marks the current branch`; `lists remote branches without a
      local one`; `leaves out origin/HEAD`; `leaves out a remote branch a local
      branch tracks`; `lists the current branch before the first commit`; `marks
      nothing on a detached HEAD`; `reads every kind of branch name`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-git`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(git): list branches`

---

### Task 2: The endpoint

**Files:**

- Create: `libs/shared/contracts/src/git/git-branches.schema.ts` (+ spec)
- Modify: `libs/shared/contracts/src/index.ts`,
  `libs/server/feature/sync/src/git/git.controller.ts` (+ spec),
  `libs/server/feature/sync/src/git/git.dto.ts`,
  `apps/server-e2e/src/git.e2e.spec.ts`

**Interfaces:**

- Produces: `GET /api/v1/repositories/:id/git/branches` (`gitBranches`,
  `GitBranchList`: `BranchList` plus `singleBranch: boolean`, from the
  repository's clone mode, for GA-41's note).

- [ ] **Step 1: Write the failing tests**: `answers another user's repository
      like a missing one`; end to end, `lists a full clone's branches`, `lists
      what a single-branch clone has`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-sync`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [ ] **Step 5: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(sync): list branches`.
