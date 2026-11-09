# Switching Branches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 87 of [the step 4 index](2026-11-08-00-roadmap-step-4.md):
selecting a branch switches to it, or says plainly why not, and the tree, the
open file and **Changes** follow.

**Architecture:** `BranchActionsService` sends waiting saves first (GA-40), then
asks the backend. Everything that follows a switch is already there:
`files.changed` with `all` drives the tree (FB-41) and the open file (FB-42,
ED-24), and `git.changed` the status. So this plan adds one service, the refusal
and the tests that prove it.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-advanced.md` (GA-37, GA-39, GA-40, GA-43,
AC-GIT-002.15, AC-GIT-002.17); `docs/requirements/file-browser.md` (FB-41,
FB-42); `docs/requirements/editor.md` (ED-17, ED-24).

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- A refused switch shows a dialog, as it answers a choice just made: "Commit or
  discard your changes before switching branches.", the changed files from
  `GitStatusStore`, and **Show changes**, which closes it and opens **Changes**.
- Other failures use a toast with their reason (GA-43).
- Selecting the current branch does nothing.

## Review Focus

- **A save waiting when the branch is chosen** goes first, so that it counts as
  a change and refuses the switch, rather than landing on the other branch →
  Task 1 test `sends a waiting save first, and is then refused`.
- **A save that fails first** stops the switch → Task 1 test `does not switch
  when a save failed`.
- **An open file that is not on the new branch** closes and says so (FB-42). The
  route stays, as FB-13 and AC-FILE-001.21 have it, so that switching back shows
  the file again → Task 2 test (end to end) `closes a file the new branch does
  not have`.
- **A long list of changed files** scrolls inside the dialog → Task 1 test
  `shows many files in a scrolling list`.
- **A switch from another tab** updates this tab without a reload → Task 2 test
  (end to end) `follows a switch made in another tab`.

---

### Task 1: The service and the refusal

**Files:**

- Create (with `toolkit-nx`):
  `services/branch-actions/branch-actions.service.ts`, `dialogs/switch-refused/`
  under `libs/web/feature-repository-screen/src/repository-screen/` (+ specs)
- Modify: `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `GitApi.switchBranch`, `OpenFilesService.flushAll`,
  `GitStatusStore`, `BranchChoice`.
- Produces: `BranchActionsService.open(): Promise<void>`, which opens the list
  and acts on the choice, and `showChanges: Observable<void>`. Provided by the
  page.

- [ ] **Step 1: Write the failing tests**: `switches to a local branch`; `tracks
      a remote branch`; `sends a waiting save first, and is then refused`; `does
      not switch when a save failed`; `does nothing for the current branch`;
      `says why with the changed files`; `shows many files in a scrolling list`;
      `Show changes opens Changes`; `says why any other failure happened`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): switch branches`

---

### Task 2: On the page, end to end

**Files:**

- Modify: `pages/repository-screen/repository-screen.page.*`,
  `apps/web-e2e/src/changes.spec.ts`, `docs/product/mvp.md`

- [ ] **Step 1: Write the tests**: `AC-GIT-002.15: the branch list shows local
      and remote branches and filters them by name; selecting origin/feature
      creates and switches to a local feature that tracks it`; `AC-GIT-002.17:
      switching branches with uncommitted changes is refused with the list of
      changed files; without changes, the switch updates the tree and the open
      file`; `closes a file the new branch does not have`; `follows a switch
      made in another tab`.
- [ ] **Step 2: Run them and see them fail** — `npx nx e2e web-e2e`.
- [ ] **Step 3: Connect the service** to the bar's `openBranches`.
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Update the status**: REQ-GIT-002 adds `switch-branch-ui`, and
      removes GA-37, GA-39 and GA-40. Run `doc-ids.mjs criteria` and copy its
      result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repository-screen): selecting a
      branch switches to it`.
