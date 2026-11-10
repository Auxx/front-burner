# Saves During a Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 90 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): during
a merge, a save to an unresolved conflicting file is allowed, and every other
change to the working copy is still refused.

**Architecture:** `WorkingTreeGuard` gains `changeFile`, used only by
`FileContents.save`. Its check, inside the lock, asks git whether the path has
unmerged stages. A resolved file is refused too: its content was added to the
index, so a later save would change the file on disk but not what **Commit
merge** commits _(plan's call)_; the user chooses **Start over** to edit it
again (GC-18).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-conflicts.md` (GC-3, GC-12, AC-GIT-003.9);
`docs/requirements/editor.md` (ED-19, ED-25); `docs/architecture/git-engine.md`
A-5.3.

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- A refused save answers `409 merge-in-progress`, as every other refused change
  does, which the save status already words (ED-18).
- Create, rename, delete, discard, commit, push, pull and switching are
  unchanged: refused during a merge by their existing checks.

## Review Focus

- **A file that stopped being unresolved between the client's read and its
  save:** the check runs inside the lock, against the index → Task 1 test
  `refuses a save to a file resolved on another device`.
- **A save with a conflicting name in another folder** must not pass by matching
  only the file name → Task 1 test `checks the whole path`.
- **A path with pathspec magic** must be read literally: `git ls-files`
  otherwise matches more than one name → Task 1 test `reads the path literally`.
- **Recreating a deleted file** (ED-21) stays refused during a merge, as a save
  never creates one → Task 1 test `refuses to recreate a file during a merge`.

---

### Task 1: The guard

**Files:**

- Modify: `libs/server/core/git/src/engine/git-merge.ts` (+ spec),
  `libs/server/feature/files/src/actions/working-tree-guard.ts` (+ spec),
  `libs/server/feature/files/src/content/file-contents.ts` (+ spec),
  `apps/server-e2e/src/git.e2e.spec.ts`, `docs/architecture/git-engine.md`,
  `docs/product/mvp.md`

**Interfaces:**

- Produces:
  - `GitMerge.isUnresolved(workingCopy: string, path: string):
    Promise<boolean>`: `git --literal-pathspecs ls-files -u -- <path>` prints
    something.
  - `WorkingTreeGuard.changeFile<T>(repositoryId: number, root: string, path:
    string, task: () => Promise<T>): Promise<T>`: `change`, except that during a
    merge an unresolved path goes ahead.

- [x] **Step 1: Write the failing tests**: `saves an unresolved conflicting
      file`; `keeps it unresolved after a save`; `refuses a save to a file not
      in the merge`; `refuses a save to a file resolved on another device`;
      `checks the whole path`; `reads the path literally`; `refuses to recreate
      a file during a merge`; end to end, `AC-GIT-003.9: during the merge,
      saving a file that is not conflicting, switching branches, pulling and
      pushing are refused by the API`.
- [x] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-core-git server-feature-files`.
- [x] **Step 3: Implement.** A-5.3 says what the lock allows during a merge.
- [x] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [x] **Step 5: Update the status**: REQ-EDIT-001 adds `conflict-saves`, and
      removes ED-19. REQ-GIT-003 adds it; GC-3 and GC-12 "(only the backend is
      built)". Run `doc-ids.mjs criteria` and copy its result.
- [x] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(files): save conflicting files during
      a merge`.
