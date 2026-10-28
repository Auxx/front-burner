# Create and Rename in the Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 19 of [the step 2 index](2026-10-28-00-roadmap-step-2.md): from
the file tree the user creates Markdown files and folders and renames them, with
the name checked as they type, the final name shown, and warnings for ignored
and empty folders. A new file opens at once; a renamed open file stays open
under its new path.

**Architecture:** In `web/feature-repository-screen`. Each tree row gets an
actions menu (`uiTreeItemMenu` + `ui-menu`) built from one function that lists
the actions allowed for an entry, so that plan 20 adds **Delete** in one place.
Two dialogs, **New entry** (file or folder) and **Rename**, use plan 17's
`EntryNameSchema` for the problems and the loaded listing for a quick clash
check; the backend has the last word (FB-4). After its own action the screen
reloads the parent folder at once, without waiting for `files.changed` (plan
21).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/file-browser.md` (REQ-FILE-001: FB-12's **New
file**, FB-24, FB-25, FB-27 to FB-36, FB-45, FB-46's actions menu; criteria 13,
14, 15, 16, 17 without the editor, the actions half of 23);
`docs/architecture/api.md` A-3.9.

## Global Constraints

- The shared constraints of [the step 2 index](2026-10-28-00-roadmap-step-2.md)
  apply.
- Allowed actions (FB-24, FB-35, FB-37): a folder — **New file**, **New
  folder**, **Rename**; a Markdown file — **Rename**; a non-Markdown file or a
  symbolic link — none yet (plan 20 adds **Delete**); a submodule — none. An
  entry with no actions shows no actions button.
- The actions menu opens from its button and from the keyboard (Shift+F10, the
  ContextMenu key, as `ui-tree` provides); nothing needs a right-click, a long
  press or a drag (FB-24).
- **New file**: the field starts as `untitled.md` with `untitled` selected; the
  dialog shows the final name ("Will be created as notes.md") whenever it
  differs from what was typed (FB-29).
- English texts, exactly:
  - FB-31's warning: "This file matches a .gitignore rule, so git won't commit
    it." (for a folder: "This folder matches a .gitignore rule, so git won't
    commit anything in it." _(plan's call, FB-34)_);
  - FB-33's note in the **New folder** dialog: "Empty folders aren't saved in
    git. Add a file to keep this folder.";
  - FB-35's second confirmation: "{count, plural, one {# non-Markdown file
    moves} other {# non-Markdown files move}} with this folder." with **Rename**
    and **Cancel** _(plan's call)_;
  - field errors by code: `empty` "Enter a name."; `dot` "This name isn't
    allowed."; `separator` "Names can't contain / or \\."; `control` "Remove
    tabs, line breaks and other control characters."; `edge-space` "Names can't
    start or end with a space."; `git` "This name is reserved by git.";
    `too-long` "Use a shorter name."; `name-taken` "There is already a file or
    folder with this name here."
- The ignore warning is shown when the parent folder's listing says it is
  ignored, or when `FilesApi.isIgnored` says so for the final name, asked at
  most once per 300 ms of typing.

## Review Focus

- **Typing `notes.txt` as a new file's name** must show "Will be created as
  notes.txt.md" before the user confirms → Task 2 test `shows the final name`.
- **The backend refusing a name the client accepted** (a sibling created from
  another device a moment ago) must keep the dialog open with the text and show
  `name-taken` under the field → Task 2 test `keeps the dialog open with the
  server's field error`.
- **Renaming a folder that holds the open file** must reopen the file at its new
  path, and keep the renamed folder and its expanded sub-folders expanded → Task
  3 test `follows the open file into a renamed folder`.
- **Renaming `readme.md` to `README.md`** must not be blocked by the client's
  own clash check → Task 2 test `allows a case-only rename of the entry itself`.
- **Cancelling the second confirmation** must leave the folder and the dialog as
  they were → Task 3 test `cancels a folder rename at the second confirmation`.

---

### Task 1: Actions menu and buttons

**Files:**

- Create:
  `libs/web/feature-repository-screen/src/repository-screen/utils/entry-actions/entry-actions.ts`
  (+ `.spec.ts`)
- Modify: `components/file-tree/*`, `components/editor-area/*`,
  `pages/repository-screen/*`, `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `TreeEntry` (plan 16); `uiTreeItemMenu`, `uiMenuTrigger`, `ui-menu`.
- Produces:
  - `type EntryAction = 'new-file' | 'new-folder' | 'rename' | 'delete'`;
    `entryActions(entry: Entry): EntryAction[]` — the list of Global Constraints
    (no `delete` yet).
  - `FileTreeComponent` output `action: { action: EntryAction; path: string }`;
    **New file** and **New folder** buttons above the tree, which emit with
    `path: ''`.
  - The editor area's empty state gets its **New file** button (FB-12).

- [ ] **Step 1: Write the failing tests**: `lists each kind's actions`; `shows
      no actions button for an entry without actions`; `emits the root actions
      from the buttons above the tree`; `opens the actions menu from the
      keyboard`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): add entry actions`

---

### Task 2: New entry and Rename dialogs

**Files:**

- Create (generated dialogs): `dialogs/new-entry`, `dialogs/rename-entry`
  (each + `.spec.ts`)
- Create: `src/repository-screen/utils/entry-name-field/entry-name-field.ts` (+
  `.spec.ts`)
- Modify: `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `EntryNameSchema`, `FilesApi.createEntry`, `.renameEntry`,
  `.isIgnored` (plan 17); `withMarkdownExtension`, `sameEntryName` (plan 13);
  `ui-dialog`, `DialogService`, `ui-field`, `ui-input`, `ui-inline-banner`.
- Produces:
  - `entryNameField(options: { kind: 'file' | 'folder'; siblings: () => readonly
    string[]; current?: string })` — returns signals `finalName`, `problem:
    string | null` (a code of Global Constraints), for one Signal Forms field.
  - `NewEntryDialog` (data `{ repositoryId; folder; kind; folderIgnored;
    siblings }`) closes with the created `EntryPath`; `RenameEntryDialog` (data
    `{ repositoryId; path; entry; siblings }`) closes with the new `EntryPath`.
    Both keep their input and show the error on failure, mapping field errors to
    the field and other codes to a banner (FB-45, A-3.9).

- [ ] **Step 1: Write the failing tests**: `starts with untitled selected`;
      `shows the final name`; `shows each problem's text`; `flags a clash with a
      sibling ignoring case`; `allows a case-only rename of the entry itself`;
      `warns when the parent folder is ignored`; `warns when the server says the
      new name is ignored`; `notes that empty folders aren't saved`; `keeps the
      dialog open with the server's field error`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): name new and renamed
      entries`

---

### Task 3: Wiring the actions to the screen

**Files:**

- Create (generated service): `services/entry-commands` (+ `.spec.ts`)
- Modify: `services/file-tree-store/*` (+ spec), `pages/repository-screen/*`

**Interfaces:**

- Consumes: the dialogs (Task 2); `FilesApi.entrySummary` (plan 17);
  `FileTreeStore` (plan 16).
- Produces:
  - `FileTreeStore.renamed(from: string, to: string): void` — rewrites expanded
    folder paths under `from`, and the remembered last file.
  - `EntryCommands.run(action: EntryAction, path: string): Promise<void>`:
    - `new-file`: opens the dialog; on success reloads the folder and navigates
      to the new file (FB-30);
    - `new-folder`: on success reloads the parent, expands the new folder and
      makes it the tree's active row (FB-32);
    - `rename`: for a folder, first asks `entrySummary` and, when `nonMarkdown >
      0`, the second confirmation; on success reloads the parent, calls
      `renamed`, and when the route's file is the entry or lies under it,
      navigates to its new path with `replaceUrl` (FB-36).

- [ ] **Step 1: Write the failing tests**: `opens a new file after creating it`;
      `expands a new folder`; `asks a second time before renaming a folder with
      images`; `cancels a folder rename at the second confirmation`; `follows
      the open file into a renamed folder`; `keeps a renamed open file open`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): create and rename from the
      tree`

---

### Task 4: End-to-end tests and status

**Files:**

- Modify: `apps/web-e2e/src/repository-screen.spec.ts`, `docs/product/mvp.md`

- [ ] **Step 1: Write the tests**: `AC-FILE-001.13: creates notes.md and opens
      it, warning inside an ignored folder`; `AC-FILE-001.14: refuses README.md
      next to readme.md and renames readme.md to README.md`; `AC-FILE-001.15:
      creates an empty folder with the note`; `AC-FILE-001.16: renames guide.md
      to guide.txt.md, offers no Rename for a .png, and confirms twice for a
      folder with images`; `AC-FILE-001.17: keeps a renamed open file open`;
      `AC-FILE-001.23: creates and renames with the keyboard alone and by touch
      alone`; `has no axe violations` with each dialog open.
- [ ] **Step 2: Run them** — `npx nx e2e web-e2e`; all pass in the NF-12.2
      matrix.
- [ ] **Step 3: Update the status**: REQ-FILE-001 adds FB-24, FB-25, FB-27 to
      FB-36 and FB-45 (FB-36 without the waiting save, which comes with plan
      25), Built in adds `create-rename-ui`. Run `doc-ids.mjs criteria` and copy
      its result.
- [ ] **Step 4: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; commit
      `test(repository-screen): cover creating and renaming`.
