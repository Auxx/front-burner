# Show Mine and Theirs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 97 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): **Show
mine** and **Show theirs** open that version of a conflicting Markdown file
read-only, so that the user can compare before choosing.

**Architecture:** A small component holds its own read-only editor state,
`createEditorState({ readOnly: true, … })`, as nothing of it is ever saved: it
does not go through `OpenFilesService`, which would give it a saver and a
browser draft _(plan's call)_. It shows the raw text; the preview is of no use
for a comparison of source lines.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-conflicts.md` (GC-17, AC-GIT-003.16);
`docs/requirements/editor.md` (ED-25).

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- Offered for a Markdown file on each side that exists and is at most 1 MB
  (`oursSize`, `theirsSize`). Otherwise there is no button: a size is enough.
- The banner says "This is your version, read-only." or "This is their version
  (_origin/main_), read-only.", with **Back** (ED-25).

## Review Focus

- **A version the backend refuses,** such as one not valid UTF-8, says why, with
  **Back** → Task 1 test `says why a version cannot be shown`.
- **The file's edits while a version is shown:** the editor state of the file is
  not touched, and comes back with its cursor and undo → Task 1 test `keeps the
  file's editor as it was`.
- **Typing in the version** must do nothing, on a phone also: no on-screen
  keyboard → Task 1 test `cannot be edited, with no keyboard on a phone`.
- **Another selected file, or the merge ending,** closes the version → Task 1
  test `goes when another file is selected or the merge ends`.

---

### Task 1: The version

**Files:**

- Create (with `toolkit-nx`): `components/conflict-version/` under
  `libs/web/feature-repository-screen/src/repository-screen/` (+ spec)
- Modify: `components/conflict-file/*`, `apps/web/public/i18n/en.json`,
  `apps/web-e2e/src/changes.spec.ts`, `docs/product/mvp.md`

**Interfaces:**

- Consumes: `GitApi.gitMergeVersion`, `createEditorState`,
  `CodeEditorComponent`.
- Produces: `ConflictVersionComponent` (`rs-conflict-version`): inputs
  `repositoryId`, `path`, `side: 'ours' | 'theirs'`, `from: string`; output
  `back`.

- [ ] **Step 1: Write the failing tests**: `AC-GIT-003.16: Show mine and Show
      theirs on a conflicting Markdown file open that version read-only, and the
      list shows the size of each version` (end to end); `offers no button for a
      large file or a PNG`; `says why a version cannot be shown`; `keeps the
      file's editor as it was`; `cannot be edited, with no keyboard on a phone`;
      `goes when another file is selected or the merge ends`; `Back returns
      focus to its button`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-003 adds `show-versions-ui`, and
      removes GC-17. REQ-EDIT-001 adds it, and removes ED-25. Run `doc-ids.mjs
      criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repository-screen): show mine and
      theirs`.
