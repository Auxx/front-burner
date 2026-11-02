# Git Status API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 44 of [the step 3 index](2026-11-02-00-roadmap-step-3.md): the
API says which branch a working copy is on, its counts against the upstream, and
every changed file.

**Architecture:** One `status` operation in `GitEngine`, parsing `git status
--porcelain=v2 --branch -z`, and a new `server/feature/sync` library with the
first endpoint of the `git` tag. Status never writes the index
(`--no-optional-locks`), so it runs outside the working-tree lock and a save
never waits for it. The new `git.changed` event is contract only here; plans 50,
52 and 57 publish it.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-advanced.md` (REQ-GIT-002: GA-1, GA-11's rules,
the terms **Changes** and **To push / To pull**, GA-42's read side);
`docs/architecture/git-engine.md` A-5.3, A-5.10; `docs/architecture/api.md`
A-3.11.

## Global Constraints

- The shared constraints of [the step 3 index](2026-11-02-00-roadmap-step-3.md)
  apply.
- The command is exactly `--no-optional-locks status --porcelain=v2 --branch -z
  --untracked-files=all --no-renames --ignored=no`. A rename is one deleted and
  one added file (GA-11).
- Ignored entries are never changes (AC-GIT-002.2).
- Changes are sorted by path, comparing code units, so that the order is the
  same on every device.
- An unborn branch reports `branch: 'main'` and `noCommits: true`, whatever
  `HEAD` names, as GA-42 says; plan 52 points `HEAD` at `main` on the first
  commit.
- Without commits, and on a detached `HEAD`, `upstream` is `null` and both
  counts are 0, even when git reports the upstream of what `HEAD` names or of
  the branch it left _(plan's call)_.
- A file removed from the index but still on disk (`git rm --cached`) is one
  `modified` entry, not a deleted and an added one with the same path _(plan's
  call)_.

## Review Focus

- **Paths with a newline, a tab, quotes or non-ASCII characters** must come back
  exact → Task 1 test `reads paths with special characters as they are`.
- **A nested git repository in the working copy** is shown by git as `dir/`, and
  committing it would create a gitlink; it must not be listed → Task 1 test
  `leaves out a nested repository`.
- **A detached `HEAD`** must not throw → Task 1 test `reports a detached HEAD as
  no branch`.
- **A branch whose upstream was deleted** (`branch.upstream` without
  `branch.ab`) must not throw, with both counts 0 → Task 1 test `reports zero
  counts when the upstream is gone`.
- **A repository that is cloning or failed** answers `409
  repository-not-openable`, and another user's `404` → Task 2 test `answers only
  for the owner's ready repository`.

---

### Task 1: The engine's status

**Files:**

- Create: `libs/server/core/git/src/engine/git-status.ts` (+ `.spec.ts`), a pure
  parser
- Modify: `libs/server/core/git/src/engine/git-engine.ts` (+ spec),
  `libs/server/core/git/src/index.ts`

**Interfaces:**

- Produces:
  - `parseStatus(stdout: string): WorkingCopyStatus`.
  - `GitEngine.status(workingCopy: string): Promise<WorkingCopyStatus>`, where
    `WorkingCopyStatus` is `{ branch: string | null; noCommits: boolean;
    upstream: string | null; ahead: number; behind: number; changes: { path:
    string; state: 'modified' | 'added' | 'deleted' }[] }`.
- States from the record's `XY`: `?` or `A` is `added`; a `D` in either column
  is `deleted`; anything else is `modified`. In `-z` mode a `1` record's path is
  everything after its eighth space; a `u` record (a conflict, step 4) is
  `modified`.

- [ ] **Step 1: Write the failing tests** against a real repository: `lists
      modified, added and deleted files, sorted by path`; `does not list an
      ignored file`; `reports a rename as one deleted and one added file`;
      `reads paths with special characters as they are`; `leaves out a nested
      repository`; `reports the branch, upstream and counts`; `reports an
      unpublished branch without an upstream`; `reports zero counts when the
      upstream is gone`; `reports a detached HEAD as no branch`; `reports main
      and noCommits in a repository without commits`; `does not touch the index
      file`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-git`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(git): working copy status`

---

### Task 2: The sync feature and the endpoint

**Files:**

- Create (generated with `@nx/nest:library`, tags `scope:server`,
  `type:feature`): `libs/server/feature/sync`; in it `src/sync.module.ts`,
  `src/git/git.controller.ts`, `src/git/git.dto.ts` (+ spec);
  `libs/shared/contracts/src/git/git-status.schema.ts` (+ spec)
- Modify: `libs/shared/contracts/src/index.ts`,
  `libs/shared/contracts/src/events/push-event.schema.ts` (+ spec),
  `apps/server/src/app/app.module.ts`, `docs/architecture/api.md`,
  `docs/architecture/git-engine.md`

**Interfaces:**

- Consumes: `OpenableRepository`, `FilesModule`'s exports (plan 14).
- Produces:
  - `GitStatusSchema` (`.meta({ id: 'GitStatus' })`): `WorkingCopyStatus` plus
    `mergeInProgress: boolean`. Plan 55 adds `lastCommit`, plan 57 adds
    `networkJob`.
  - `GET /api/v1/repositories/:id/git/status` (`gitStatus`), tag `git`, client
    class `GitApi`.
  - The push event `{ type: 'git.changed', repositoryId: number }`.
- `api.md` A-3.11 adds `git.changed` _(plan's call: an event of its own, since a
  commit or a push changes no files)_. `git-engine.md` A-5.3 says that read-only
  status and diff run with `--no-optional-locks` outside the lock.

- [ ] **Step 1: Write the failing tests**: `answers only for the owner's ready
      repository`; `reports a merge in progress`; `the git.changed event
      parses`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-feature-sync shared-contracts`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-002 is **In progress**, Built in
      `git-status-api`, points not built: everything except GA-11's rules on the
      backend. Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; `npm run check:tags`; commit
      `feat(sync): git status API`.
