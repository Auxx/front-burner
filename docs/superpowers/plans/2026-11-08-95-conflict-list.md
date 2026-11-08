# Conflict List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 95 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): during
a merge, the left pane lists the conflicting files instead of the file tree and
**Changes**, and nothing that the merge does not allow is offered.

**Architecture:** The page already swaps panes for **Changes**; it now has a
third state, chosen by `MergeStore.merging`. The tree and **Changes** stay in
place, hidden, so that they keep their state for when the merge ends. The same
goes for the editor, whose unsaved edits stay in the browser draft (ED-25).
Which file is selected is `MergeStore.selected`, not in the URL, as for a diff,
since a reload must work out the merge again anyway _(plan's call)_. Until plan
96 the editor area shows only the file's name and kind.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-conflicts.md` (GC-2, GC-7, GC-8's selection,
AC-GIT-003.1); `docs/requirements/git-advanced.md` (GA-4, GA-28's switch,
AC-GIT-002.20); `docs/requirements/file-browser.md` (FB-9, FB-26,
AC-FILE-001.20); `docs/requirements/editor.md` (ED-25).

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- Each entry shows its name, its folder in a quieter style, its kind in words
  ("Both changed", "Both added", "Deleted by me", "Deleted by them"), and
  **Unresolved** or **Resolved** in words and with an icon (NF-13.7).
- Below the list: "3 other files merged without conflicts", which expands to
  list them. With none, the line is not shown. The words use "1 other file".
- On narrow screens the list is in the drawer (FB-9), and selecting a file
  closes it.
- The first unresolved file is selected when the merge is first read.

## Review Focus

- **A merge started while a diff is showing** ends the diff, and when the merge
  ends the screen is back to the file → Task 1 test `hides the diff during a
  merge`.
- **A merge in another tab while this tab has unsaved edits:** the edits stay in
  the browser draft and come back afterwards (ED-25) → Task 1 test (end to end)
  `keeps unsaved edits through a merge`.
- **A file resolved or gone from the list on another device:** the selection
  moves on and does not point at nothing → Task 1 test `moves the selection when
  the file leaves the list`.
- **Thousands of files merged without conflicts** must not slow the screen: the
  expanded list renders the first 200, then "and 4,800 more" → Task 1 test
  `shows the first 200 of 5,000 other files`.
- **The `ui-activity-bar` is gone:** focus and the skip link must still lead
  somewhere → Task 1 test `keeps focus in the side pane when the bar goes`, with
  axe-core.

---

### Task 1: The list instead of the tree

**Files:**

- Create (with `toolkit-nx`): `components/conflict-list/`,
  `components/conflict-file/` under
  `libs/web/feature-repository-screen/src/repository-screen/` (+ specs)
- Modify: `services/merge-store/merge-store.service.ts` (+ spec),
  `pages/repository-screen/repository-screen.page.*`,
  `apps/web/public/i18n/en.json`, `apps/web-e2e/src/changes.spec.ts`,
  `docs/product/mvp.md`

**Interfaces:**

- Consumes: `MergeStore`.
- Produces:
  - `MergeStore.selected: Signal<string | null>`, `MergeStore.select(path:
    string): void`, and `MergeStore.selectedFile: Signal<GitConflictFile |
    null>`.
  - `ConflictListComponent` (`rs-conflict-list`): inputs `state: GitMergeState`,
    `selected: string | null`; output `selectPath`.
  - `ConflictFileComponent` (`rs-conflict-file`): input `file: GitConflictFile`,
    shown in the editor area. Plans 96, 97, 99 and 100 fill it.

- [ ] **Step 1: Write the failing tests**: `AC-GIT-003.1: a pull that conflicts
      on guide.md switches the repository screen to conflict resolution, with
      Merging origin/main into main and 0 of 1 file resolved; another device
      that opens the repository sees the same screen` (end to end, two
      contexts); `AC-FILE-001.20: while a merge with conflicts is in progress,
      the file tree is replaced by the list of conflicting files, and the API
      refuses create, rename and delete` (end to end); `AC-GIT-002.20: while a
      merge is in progress, commit, discard, pull, push and branch switching are
      not offered, and the API refuses them` (end to end); `lists the files
      sorted, with their kinds and states in words`; `expands the files merged
      without conflicts`; `shows the first 200 of 5,000 other files`; `shows no
      branch button during a merge`; `selects the first unresolved file`; `moves
      the selection when the file leaves the list`; `hides the diff during a
      merge`; `keeps unsaved edits through a merge` (end to end); `is in the
      drawer on a phone, and selecting closes it`; `keeps focus in the side pane
      when the bar goes`; `goes back to the tree and Changes when the merge
      ends`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-003 adds `conflict-list`, and
      removes GC-2 and GC-7. REQ-GIT-002 adds it, and removes GA-4 and the rest
      of GA-28. REQ-FILE-001 adds it, and removes FB-26. Run `doc-ids.mjs
      criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repository-screen): the conflict
      list`.
