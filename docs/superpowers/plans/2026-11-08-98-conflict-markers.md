# Conflict Markers in the Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 98 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): the
code editor can tell conflicts apart in a document, show them, and accept mine,
theirs or both with an edit that can be undone. Nothing on the screen uses it
until plan 99.

**Architecture:** A CodeMirror extension in `web/code-editor`, independent of
git and of the repository screen, so that it can be tested with plain strings. A
`StateField` keeps the regions, parsed from the document, and a decoration set
shows them. Each **Accept** is one transaction, so that undo brings the whole
conflict back. Buttons inside CodeMirror's `contenteditable` can't be reached
with `Tab`, which the editor keeps for itself, so the widgets serve pointer and
touch, and plan 99's conflict bar, outside the editor, offers the same three for
the conflict at the cursor to the keyboard and screen readers _(plan's call)_.

**Tech Stack:** CodeMirror 6, already a dependency. The colours are the
`Conflict` tokens of `docs/architecture/design-system.md` (mine, theirs, marker
line).

**Spec:** `docs/requirements/git-conflicts.md` (GC-10, GC-11, GC-28); NF-13.5,
NF-13.7.

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- A region starts at a line beginning `<<<<<<< `, has a line that is exactly
  `=======`, and ends at a line beginning `>>>>>>> `. Lines that do not make up
  such a region are plain text and get no decoration, since the user can edit
  freely (GC-11).
- **Accept mine** replaces the region, markers included, with my lines; **Accept
  theirs** with theirs; **Accept both** with mine followed by theirs.
- Mine and theirs differ by background and by the label on the marker line
  ("Mine (main)", "Theirs (origin/main)"), never by colour alone (NF-13.7). The
  label's words come from the caller, as this library has no translations; the
  branch name comes from the marker.
- Touch targets of the widget buttons meet NF-13.5: at least 24 by 24 CSS
  pixels.
- `npx nx run web-code-editor:size-check` stays within its budget.

## Review Focus

- **An unfinished region,** such as `<<<<<<< x` with no end while the user edits
  it, is ignored, not stretched to the next marker → Task 1 test `ignores a
  region with no end`.
- **A second `<<<<<<<` before the first ends** starts over from the second, as
  git's markers don't nest → Task 1 test `restarts at a nested start`.
- **A file with CRLF line endings:** the editor's document uses `\n`, so a
  marker with `\r` can't reach it, and the parser needs no case for it; a region
  at the very end with no final line break does → Task 1 test `reads a region at
  the end of the file`.
- **Accepting one conflict** keeps the others' positions, as the parse is
  repeated from the new document → Task 2 test `the second conflict still works
  after the first is accepted`.
- **A large file:** parsing must stay out of the way of typing (NF-2.4), so it
  runs only when the document changed and the extension is on, which only a
  conflicting file has, and goes through the text once. A timing test would be
  unreliable in CI → Task 2 test `parses only when the document changed`.

---

### Task 1: Regions

**Files:**

- Create: `libs/web/code-editor/src/code-editor/conflicts/conflict-regions.ts`
  (+ spec)
- Modify: `libs/web/code-editor/src/index.ts`

**Interfaces:**

- Produces: `ConflictRegion`: `{ from: number; to: number; mine: { from: number;
  to: number }; theirs: { from: number; to: number }; mineLabel: string;
  theirsLabel: string }`, as document offsets, with the labels read from the
  markers; and `conflictRegions(text: string): ConflictRegion[]`.

- [ ] **Step 1: Write the failing tests**: `finds each region, and its parts`;
      `reads the branch names`; `ignores a region with no end`; `ignores a
      region with no middle`; `restarts at a nested start`; `reads a region at
      the end of the file`; `has none in plain text`; `needs a space after the
      start`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-code-editor`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(code-editor): find conflicts in a document`

---

### Task 2: The extension

**Files:**

- Create: `libs/web/code-editor/src/code-editor/conflicts/conflict-extension.ts`
  (+ spec)
- Modify: `libs/web/code-editor/src/code-editor/state/editor-state.ts` (+ spec),
  `libs/web/code-editor/src/code-editor/theme/editor-theme.ts`,
  `libs/web/code-editor/src/index.ts`

**Interfaces:**

- Produces:
  - `ConflictTexts`: `{ mine: (branch: string) => string; theirs: (branch:
    string) => string; acceptMine: string; acceptTheirs: string; acceptBoth:
    string }`.
  - `EditorStateOptions.conflicts?: ConflictTexts`, which adds the extension in
    `createEditorState`.
  - `conflictsIn(state: EditorState): readonly ConflictRegion[]`.
  - `conflictAtCursor(state: EditorState): number | null`: the index of the
    region the cursor is in, or `null`.
  - `acceptConflict(view: EditorView, index: number, choice: 'mine' | 'theirs' |
    'both'): void`.
  - `goToConflict(view: EditorView, index: number): void`: moves the cursor to
    the start of the region, and scrolls to it.

- [ ] **Step 1: Write the failing tests**: `shows mine and theirs with their own
      backgrounds and labels`; `accepts mine`; `accepts theirs`; `accepts both,
      mine first`; `one undo brings the conflict back`; `the second conflict
      still works after the first is accepted`; `updates the regions as the user
      types`; `parses only when the document changed`; `removes a region when a
      marker is deleted`; `says which conflict has the cursor`; `moves the
      cursor to a conflict`; `changes nothing without the option`; `does not
      offer the widgets in a read-only editor`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-code-editor`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(code-editor): show and accept
      conflicts`.
