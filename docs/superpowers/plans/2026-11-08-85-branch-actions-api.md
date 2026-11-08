# Branch Actions API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 85 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): the
API switches to a local branch, makes a local branch that tracks a remote one,
and creates a new branch from the current commit.

**Architecture:** Both are local, so they run in the request inside
`WorkingTreeGuard.change`, with `FRONT_BURNER_GIT_TIMEOUT`, as a commit does; a
switch that proves slow becomes a job later (GA-3) _(plan's call)_. The checks
run inside the lock, as a save can make a clean working copy dirty until then.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-advanced.md` (GA-4, GA-37, GA-38, GA-39, GA-43,
the API for AC-GIT-002.15 to AC-GIT-002.17); `docs/architecture/git-engine.md`
A-5.10; D-4.3.

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- Commands: `git switch --no-guess --no-overwrite-ignore -- <name>`; `git switch
  --no-guess --no-overwrite-ignore --track -c <branch>
  refs/remotes/origin/<branch>`; `git switch --no-guess --no-track -c <name>`.
- The `--` is not optional: without it, the name `--orphan=boom` from a client's
  request empties the working copy. `trackRemote` and `create` check the name
  with `check-ref-format` first, which refuses a leading `-`.
- A name is valid when `git check-ref-format --branch <name>` exits 0 and prints
  the same name: it expands `@{-1}` to the previous branch, which must not pass.
- `POST …/switch` refuses, with `409`: `merge-in-progress` (the guard),
  `switch-uncommitted-changes`, `branch-not-found`, `branch-exists` (a remote
  branch whose local name is taken) and `switch-blocked` (git stopped before
  changing anything). `POST …/branches` refuses `400 branch-name-invalid`, `409
  branch-exists`, `409 branch-name-conflict` (`a` when `a/b` exists, or the
  reverse), and `409 no-commits`, as GA-42's first commit makes `main` whatever
  the branch is called.
- Git's messages, in `git-errors.ts` with the others (RC-5): "invalid reference"
  is `branch-not-found`, "cannot lock ref" is `branch-name-conflict`, and "would
  be overwritten" is `switch-blocked`.
- A switch publishes `files.changed` with `folders: 'all'` and `git.changed`. A
  new branch changes no file, and publishes `git.changed`.

## Review Focus

- **A name that looks like an option,** such as `--orphan=boom`, `--detach` or
  `-c`, on any of the three operations, is refused, with every file still there
  → Task 1 test `treats a name like an option as a name`.
- **`bad..name`, `@{-1}`, `HEAD`, `-x` and an empty name** are all refused
  (GA-38) → Task 1 test `refuses every kind of bad name`.
- **`a/b` when `a` exists,** which git refuses only when it writes the ref, is a
  reason next to the field, not a server error → Task 1 test `refuses a name
  that clashes with a folder of branches`.
- **Ignored files** do not count as uncommitted changes, and one the new branch
  tracks stops the switch rather than being overwritten → Task 1 test `does not
  overwrite an ignored file`.
- **A branch that exists only as `origin/main` next to a local `origin/main`**
  must still track the remote one, from its full ref → Task 1 test `tracks the
  remote branch when a local branch has its name`.

---

### Task 1: The engine

**Files:**

- Modify: `libs/server/core/git/src/engine/git-branches.ts` (+ spec),
  `libs/server/core/git/src/engine/git-errors.ts`,
  `docs/architecture/git-engine.md`

**Interfaces:**

- Produces, each throwing `GitOperationError` with the engine's codes
  `branch-name-invalid`, `branch-exists`, `branch-name-conflict`,
  `branch-not-found` and `switch-blocked`:
  - `GitBranches.switchTo(workingCopy: string, name: string): Promise<void>`;
  - `GitBranches.trackRemote(workingCopy: string, branch: string):
    Promise<void>`;
  - `GitBranches.create(workingCopy: string, name: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**: `switches to a local branch`; `treats
      a name like an option as a name`; `changes the files with the branch`;
      `says when the branch is gone`; `makes a local branch that tracks a remote
      one, and switches to it`; `says when the remote branch is gone`; `tracks
      the remote branch when a local branch has its name`; `refuses a local
      branch of that name`; `does not overwrite an ignored file`; `creates a
      branch from the current commit, unpublished, and switches to it`; `keeps
      uncommitted changes on a new branch`; `refuses every kind of bad name`;
      `refuses a name in use`; `refuses a name that clashes with a folder of
      branches`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-git`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(git): switch and create branches`

---

### Task 2: The endpoints

**Files:**

- Modify: `libs/shared/contracts/src/git/git-branches.schema.ts` (+ spec),
  `libs/shared/contracts/src/errors/error-codes.ts`,
  `libs/server/feature/sync/src/git/git.controller.ts` (+ spec),
  `libs/server/feature/sync/src/git/git-api-errors.ts` (+ spec),
  `libs/server/feature/sync/src/git/git.dto.ts`, `apps/web/public/i18n/en.json`,
  `apps/server-e2e/src/git.e2e.spec.ts`, `docs/product/mvp.md`

**Interfaces:**

- Produces:
  - `POST /api/v1/repositories/:id/git/switch` (`switchBranch`, `204`,
    `GitSwitchRequest`: `{ name: string; remote: boolean }`). With `remote`,
    `name` is the branch without `origin/`.
  - `POST /api/v1/repositories/:id/git/branches` (`createBranch`, `204`,
    `GitNewBranchRequest`: `{ name: string }`).
  - The error codes above. `switch-uncommitted-changes` says "Commit or discard
    your changes before switching branches." (GA-39).

- [ ] **Step 1: Write the failing tests**: `refuses a switch with uncommitted
      changes, and nothing changes`; `switches with only ignored files around`;
      `refuses both during a merge`; `refuses a new branch without commits`;
      `publishes files.changed and git.changed after a switch`; `publishes only
      git.changed for a new branch`; `answers another user's repository like a
      missing one`; end to end, `switches, tracks a remote branch and creates a
      branch`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-sync`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-002 adds `branch-actions-api`, with
      GA-37 to GA-39 "(only the backend is built)". Run `doc-ids.mjs criteria`
      and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(sync): switch and create branches`.
