# Editing a Conflicting File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 99 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): a
conflicting Markdown file opens in the normal editor, with its conflicts told
apart, a bar to move between them and accept, saves as usual, and a preview that
waits until no markers are left.

**Architecture:** `rs-conflict-file` opens an `editable` file through
`OpenFilesService`, so that saving, browser drafts and changes from other
devices all work as they do for any file, and `rs-editor-pane` gets a
`conflicts` input, which turns plan 98's extension on with `setConflicts`, also
for a file whose editor state was kept from before the merge. `rs-conflict-bar`,
above the editor, reads the regions from the editor's state, and gives the
keyboard and screen readers what the widgets give to pointer and touch.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-conflicts.md` (GC-9, GC-10, GC-11, GC-12,
GC-13, GC-28, AC-GIT-003.2 to AC-GIT-003.5); `docs/requirements/editor.md`
(ED-16 to ED-20, ED-24).

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- Exact text: "Conflict 2 of 5"; **Previous**, **Next**, **Accept mine**,
  **Accept theirs**, **Accept both**; a preview that says "The preview is shown
  again when no conflict markers are left."
- With the cursor in no conflict, the bar says "5 conflicts", the Accept buttons
  are unavailable, and **Previous** and **Next** go to the nearest one before
  and after the cursor. With no conflicts left, it says "No conflict markers
  left."
- The count is announced in a polite live region when it changes; each move says
  "Conflict 2 of 5: mine and theirs" (GC-28).
- The bar's Accept buttons act on the conflict at the cursor, and give focus
  back to the editor.
- `hasConflictMarkers` (plan 91) decides the preview, which uses GC-14's rule,
  so that the preview and **Mark as resolved** always agree.
- A conflicting file is opened without going through the route, which keeps
  naming the file that was open (plan 95). So when the merge ends, the page
  opens the route's path again, or goes to the empty state without one. A
  conflicting file is never remembered as this device's last file (FB-12), and a
  reload during a merge shows the merge.

## Review Focus

- **A file edited on another device during the merge** follows ED-24, as any
  open file → Task 2 test (end to end) `follows an edit made on another device`.
- **A file that is opened again after the merge ended** has no conflict
  extension or bar, and is not left read-only → Task 2 test `is a normal file
  after the merge`.
- **A conflicting file that was already open when the merge started** keeps its
  editor state, which must get the conflict view → Task 2 test `shows conflicts
  in a file that was already open`.
- **The screen when the merge ends** must show the file the URL names, not the
  last conflict → Task 2 test `opens the route's file when the merge ends`.
- **A phone's on-screen keyboard:** the bar must stay above it, and the editor
  must keep at least its usual height (NF-12.5) → Task 1 test `stays visible
  with the on-screen keyboard open`.
- **A lone `=======` line,** which is valid Markdown: GC-14's rule counts it, so
  the note stays although the bar says no conflicts are left, and **Mark as
  resolved** asks. That is what GC-13 and GC-14 say, and the user can still go
  on → Task 2 test `shows the note for a lone =======`.
- **Undoing an Accept** brings the conflict back with its widgets, the bar's
  count, and the preview's note → Task 2 test `AC-GIT-003.4`.

---

### Task 1: The conflict bar

**Files:**

- Create (with `toolkit-nx`): `components/conflict-bar/` under
  `libs/web/feature-repository-screen/src/repository-screen/` (+ spec)
- Modify: `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `conflictsIn`, `conflictAtCursor`, `acceptConflict`, `goToConflict`.
- Produces: `ConflictBarComponent` (`rs-conflict-bar`): input `state:
  EditorState`; outputs `move` (region index) and `accept` (`{ index: number;
  choice: 'mine' | 'theirs' | 'both' }`).

- [ ] **Step 1: Write the failing tests**: `says which conflict has the cursor`;
      `moves to the next and the previous`; `goes to the nearest with the cursor
      outside`; `says when no markers are left`; `accepts with the keyboard, and
      gives focus back`; `announces each move`; `meets the touch target size`;
      `stays visible with the on-screen keyboard open`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): the conflict bar`

---

### Task 2: In the editor

**Files:**

- Modify: `components/editor-pane/*`, `components/conflict-file/*`,
  `pages/repository-screen/repository-screen.page.*`,
  `apps/web/public/i18n/en.json`, `apps/web-e2e/src/changes.spec.ts`,
  `docs/product/mvp.md`

**Interfaces:**

- Produces: `EditorPaneComponent` input `conflicts: boolean`. With it the pane
  uses `ConflictTexts`, shows `rs-conflict-bar`, and shows the note instead of
  the preview while `hasConflictMarkers(content)`.

- [ ] **Step 1: Write the failing tests**: `AC-GIT-003.2: guide.md opens in the
      editor with plain markers labelled <<<<<<< main and >>>>>>> origin/main,
      even if the working copy's configuration sets merge.conflictStyle=zdiff3`
      (end to end); `AC-GIT-003.3: Conflict 1 of 3 with Next moves to the second
      conflict`; `AC-GIT-003.4: Accept mine, Accept theirs and Accept both each
      replace the conflict as described; the editor's undo brings the conflict
      back` (end to end); `AC-GIT-003.5: while markers remain, the preview says
      it will come back when no conflict markers are left; after the last one is
      removed, the preview renders again` (end to end); `saves an edit, which a
      reload shows`; `offers the editor for an editable file, first`; `does not
      offer it for a PNG or a large file`; `follows an edit made on another
      device`; `is a normal file after the merge`; `shows conflicts in a file
      that was already open`; `opens the route's file when the merge ends`;
      `does not remember a conflicting file as the last file`; `shows the note
      for a lone =======`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-003 adds `conflict-editor`, and
      removes GC-3, GC-9 to GC-13. Run `doc-ids.mjs criteria` and copy its
      result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repository-screen): edit a
      conflicting file`.
