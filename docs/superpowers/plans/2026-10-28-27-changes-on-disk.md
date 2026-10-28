# Changes on Disk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 27 of [the step 2 index](2026-10-28-00-roadmap-step-2.md): when
the open file changes on disk because of another tab, another device or (later)
a git operation, the editor follows: it reloads the file when there is nothing
to lose, asks **Reload** or **Keep mine** when there is, and offers **Recreate
it** when the file was deleted or renamed elsewhere while it had unsaved edits.
The user's own saves never trigger any of this.

**Architecture:** In `web/feature-repository-screen`. A `DiskChanges` service
follows plan 21's `files.changed` handling for the open file. An event that
carries the open file's hash (plan 23) is compared with the hash of the last
load or save; an event that names only the file's folder, or `all`, makes it ask
`fileState` for the hash. While a save of the file is in flight, the check waits
for it, so that a save and its own event are never seen as a change. A different
hash leads to ED-24; a `404` to ED-21 or FB-42.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/editor.md` (REQ-EDIT-001: ED-19's `entry-not-found`
case, ED-21, ED-23, ED-24, ED-38's notices; criteria 11, 12); `file-browser.md`
FB-42 with unsaved edits (criterion 21's editor half);
`docs/architecture/api.md` A-3.11; `web-client.md` A-8.15.

## Global Constraints

- The shared constraints of [the step 2 index](2026-10-28-00-roadmap-step-2.md)
  apply.
- **Own changes**: a change whose hash equals the open file's last loaded or
  saved hash is ignored. Nothing else is needed to recognise the user's own
  saves (A-3.11's note).
- **ED-24**, exactly:
  - no unsaved edits: the editor loads the new content, keeps the cursor at the
    same line and column as far as the new text allows and the scroll position
    at the same line, clears the undo history, and shows a short notice "This
    file was updated." (a toast);
  - unsaved edits: the editor keeps the user's content and shows a banner "This
    file changed while you were editing." with **Reload** (loads the new
    content, discards the unsaved edits and their draft) and **Keep mine**
    (saves the editor's content at once over it, D-1.3).
- **ED-21 / FB-42**: when the open file is gone (`fileState` or a save answers
  `404 entry-not-found`) and this tab did not delete or rename it:
  - no unsaved edits: plan 21's message "This file was deleted or renamed
    elsewhere." in place of the editor;
  - unsaved edits: the editor keeps the content, read-only, with the banner
    "This file was deleted or renamed elsewhere." and **Recreate it**, which
    calls `recreateFile` with the editor's content at the old path; the browser
    draft is kept until the recreate is confirmed. The save status shows "Not
    saved" and saving stops until then.
- The notices and banners are announced politely, without moving focus, and
  their buttons are reachable by keyboard (ED-38).

## Review Focus

- **The user's own save and its `files.changed` event racing** (the event
  arrives before the save's response) must never show "This file was updated." →
  Task 1 test `ignores its own save when the event comes first`.
- **Typing between the event and the hash check** must count as unsaved edits,
  so the user is asked rather than their typing overwritten → Task 2 test `asks
  when the user typed while the change was checked`.
- **A pull that changes many files (`all`)** must check only the open file's
  hash, not reload it blindly → Task 1 test `checks the hash on all`.
- **Keep mine** must leave the editor's content on disk and stop asking for that
  change → Task 2 test `keeps mine and saves over the change`.
- **Recreate it** failing because the file came back in the meantime
  (`entry-exists`) must keep the content and the draft and say so → Task 3 test
  `keeps the content when the file exists again`.

---

### Task 1: Noticing changes to the open file

**Files:**

- Create (generated service):
  `libs/web/feature-repository-screen/src/repository-screen/services/disk-changes`
  (+ `.spec.ts`)
- Modify: `services/tree-sync/*` (+ spec), `services/open-files/*` (+ spec)

**Interfaces:**

- Consumes: `files.changed` with `files` (plan 23); `FilesApi.fileState` (plan
  23); `OpenFiles` (plan 25); `TreeSync` (plan 21); `EntryCommands .ownChange`
  (plan 21).
- Produces:
  - `type DiskChange = { kind: 'changed'; hash: string } | { kind: 'gone' }`.
  - `DiskChanges.check(path: string, known?: string): Promise<DiskChange |
    null>` — `null` when the hash equals the open file's (or the path is this
    tab's own change); waits for `saver.flush()` of a save in flight first.
  - `DiskChanges.changes: Observable<{ path: string; change: DiskChange }>`, fed
    by `TreeSync` for the open file, and by `OpenFiles` when a save answers
    `entry-not-found`.

- [ ] **Step 1: Write the failing tests**: `ignores its own save`; `ignores its
      own save when the event comes first`; `reports a changed hash from the
      event`; `checks the hash on all`; `checks the hash when only the folder is
      named`; `reports a file that is gone`; `reports gone when a save is
      refused as missing`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): notice changes to the open
      file`

---

### Task 2: Reload, or Reload and Keep mine

**Files:**

- Create (generated component): `components/changed-on-disk` (+ `.spec.ts`)
- Modify: `services/open-files/*` (+ spec), `components/editor-pane/*`,
  `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `DiskChanges` (Task 1); `ToastService` (`ui`); `createEditorState`
  (plan 24).
- Produces: `OpenFiles.reload(path): Promise<void>` (reads the file, builds a
  new state with the old cursor line and column and scroll line, sets `hash`)
  and `.keepMine(path): Promise<void>` (sets `hash` to the changed hash and
  flushes a save of the editor's content); `ChangedOnDiskComponent` (the banner,
  outputs `reload`, `keepMine`).

- [ ] **Step 1: Write the failing tests**: `AC-EDIT-001.12: reloads a file
      without unsaved edits and says so`; `keeps the cursor and scroll line on
      reload`; `clears the undo history on reload`; `AC-EDIT-001.12: asks with
      unsaved edits, and Reload discards them`; `keeps mine and saves over the
      change`; `asks when the user typed while the change was checked`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): follow changes on disk`

---

### Task 3: Gone elsewhere, and Recreate it

**Files:**

- Create (generated component): `components/gone-elsewhere` (+ `.spec.ts`)
- Modify: `services/open-files/*` (+ spec), `components/editor-area/*`,
  `components/editor-pane/*`, `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `DiskChanges` (Task 1); `FilesApi.recreateFile` (plan 23);
  `DraftStore` (plan 26); `setReadOnly` (plan 24).
- Produces: `OpenFile` gains `gone: WritableSignal<boolean>`;
  `OpenFiles.recreate(path): Promise<void>` (on success: `gone` false, `hash`
  set, editor writable, draft deleted; on `entry-exists`: the banner says "A
  file with this name exists again." and keeps the content);
  `GoneElsewhereComponent` (the banner, output `recreate`).

- [ ] **Step 1: Write the failing tests**: `closes a file gone elsewhere without
      unsaved edits`; `AC-EDIT-001.11: keeps unsaved edits of a file gone
      elsewhere and recreates it`; `keeps the draft until the recreate is
      confirmed`; `keeps the content when the file exists again`; `stops saving
      while the file is gone`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): recreate a file deleted
      elsewhere`

---

### Task 4: End-to-end tests and status

**Files:**

- Modify: `apps/web-e2e/src/editor.spec.ts`, `docs/product/mvp.md`

- [ ] **Step 1: Write the tests** (two browser contexts, or a change made
      through the API, as the "other device"): `AC-EDIT-001.11: offers Recreate
      it after the file was deleted on another device`; `AC-EDIT-001.12: updates
      the editor after a change elsewhere, and asks with unsaved edits` (the
      "pull" half is step 4's; the change here comes from a save on another
      device); `never shows either notice for the user's own saves` (typing for
      10 s with saves); `AC-FILE-001.21: keeps unsaved edits of a file deleted
      on another device and offers Recreate it`; `has no axe violations` with
      each banner shown.
- [ ] **Step 2: Run them** — `npx nx e2e web-e2e`; all pass in the NF-12.2
      matrix.
- [ ] **Step 3: Update the status**: REQ-EDIT-001 adds ED-19 (all), ED-21,
      ED-23, ED-24 and ED-38; Built in adds `changes-on-disk`; REQ-FILE-001
      completes FB-42. Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 4: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; commit `test(editor): cover
      changes on disk`.
