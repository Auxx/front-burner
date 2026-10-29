# Editing and Saving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 25 of [the step 2 index](2026-10-28-00-roadmap-step-2.md):
selecting a Markdown file opens it in the editor, and edits are saved to the
working copy 1.5 seconds after typing stops, with the save status in the bar.
Waiting saves are sent at once when the user opens another file, renames the
file, leaves the screen or hides the tab. Large files open without highlighting
on phones, with a button to turn it on.

**Architecture:** The save queue of A-8.9 is a framework-light class in
`web/core` that knows nothing about files: it is given a function that sends the
content, and reports a status signal. The repository screen keeps one `OpenFile`
per path in an `OpenFiles` store (A-8.15) with its editor state, its saver and
the hash of its last load or save, so that tabs can be added later (ED-3). The
editor pane, which imports `web/code-editor`, is loaded with `@defer`, so
CodeMirror stays out of the screen's first chunk (ED-4).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/editor.md` (REQ-EDIT-001: ED-1 to ED-5, ED-9a,
ED-16 to ED-19, ED-37, ED-38's save status; criteria 2, 3, 4, 5, 10, 22, 25, the
editor half of 1, 21 and 24); `file-browser.md` FB-21's open-time checks, FB-36,
FB-39's dropped save (criteria 10, 17); `navigation.md` NV-12, NV-13 (criteria
AC-APP-001.6, AC-APP-001.9); `docs/architecture/web-client.md` A-8.9, A-8.11,
A-8.15; `non-functional.md` NF-2.2, NF-2.3, NF-3.1, NF-3.2.

## Global Constraints

- The shared constraints of [the step 2 index](2026-10-28-00-roadmap-step-2.md)
  apply.
- **Save queue** (A-8.9): a save is sent **1.5 s** after the last edit; one save
  per file in flight; while one is in flight only the newest content waits
  behind it; no save when the content equals the last saved content. A network
  failure or a `5xx` is retried after 1, 2, 4, 8, 16 and then every 30 s; a
  `4xx` is not retried (ED-18, ED-19).
- **Save status** texts, exactly (ED-18): "Saved"; "Saving…"; "Not saved —
  offline, retrying"; "Not saved — the file is larger than 1 MB"
  (`file-too-large`); "Not saved — a merge is in progress"
  (`merge-in-progress`); otherwise "Not saved" followed by the error code's
  text. The status sits in the bar after the repository name (NV-9) and is a
  polite live region, announced without moving focus (ED-38).
- A waiting save is **sent at once** when the user opens another file, starts a
  rename of the file or of a folder holding it (and the rename waits for it,
  FB-36), leaves the repository screen (including through the switcher, NV-12),
  or the tab becomes hidden (ED-17). Deleting the file or a folder holding it
  drops the waiting save (FB-39).
- **Large files on narrow screens** (ED-9a): when `injectNarrowViewport()` is
  true at opening and the file's `size` is over **102,400 bytes**, the file
  opens without highlighting and the note "Highlighting is off for large files
  on small screens, to keep typing fast." with **Turn on highlighting** shows
  above the editor. **Turn on highlighting** lasts until the file is closed,
  that is until another file is opened: a large file opened again starts without
  highlighting, though its undo history is kept (ED-8). Nothing is stored.
- **Opening errors** (FB-21): `file-too-large` and `file-not-utf8` show their
  texts (plan 23) in the editor area's message panel, not the editor.
- **Title** (NV-13): `• ` in front while the open file has unsaved edits.
- `injectNarrowViewport` is exported from `ui` (it exists in
  `libs/ui/src/layout/utils/narrow-viewport/`).
- **From plan 24's review.** `web/code-editor`'s helpers take no state:
  `setHighlighting(on)`, `setReadOnly(on)` and `setLabel(name)`, each a
  `TransactionSpec` to dispatch or apply with `state.update`. There is no
  `nonce` option: `CodeEditorComponent` gives CodeMirror the page's `CSP_NONCE`
  itself. Points for this plan to settle:
  - **Never hand the editor an older state.** `CodeEditorComponent` shows any
    `state` that is not the view's own with `view.setState`, so an input that
    lags behind the view (a store updated later or debounced) drops the
    keystrokes typed since. Write each `stateChange` back into the `OpenFile`
    synchronously, and pass a different state only when another file is opened
    or one is reloaded.
  - **Renaming the open file** calls `setLabel` with the new name on its state
    when it calls `rekey`, so that the editor's name follows (ED-37) and the
    undo history stays (ED-8).
  - **The cursor and the on-screen keyboard (ED-15).** The component scrolls the
    cursor into view on every `visualViewport` `resize` while it has the focus,
    and each one emits a `stateChange` without document changes. On iOS Safari
    the layout viewport does not shrink when the keyboard opens, so this may not
    be enough there; if the end-to-end check on a phone shows the cursor behind
    the keyboard, size the editor pane to `visualViewport.height` instead.
  - For plans 30 and 31: `topLine()` mixes a fresh `getBoundingClientRect()`
    with `view.documentTop` from CodeMirror's last measure, so right after a
    scroll it can be off by the distance scrolled. Scroll sync should read it
    inside `view.requestMeasure`, or change it to use `scrollDOM.scrollTop`.

- **Own saves and the tree** _(from plan 23's review)_: every save publishes
  `files.changed` naming the file's parent folder, so that the tree would
  re-list that folder on every autosave of every open tab. The tree skips a
  `files.changed` whose `folders` is only the parent of the files in its `files`
  when each of those files is the open file and its hash matches its last save,
  as for ED-24; a file listing's size is not shown, so nothing is lost.

## Review Focus

- **Typing during a save that is in flight** must send exactly one more save
  with the newest content after it, not one per keystroke → Task 1 test `sends
  only the newest content after the save in flight`.
- **The connection coming back** must save the waiting content without the user
  doing anything, and the status must go from offline to "Saved" → Task 1 test
  `AC-EDIT-001.5: retries until the backend answers`.
- **Opening another file within 1.5 s** must still save the first one, also when
  the second file fails to open → Task 3 test `AC-EDIT-001.4: saves the first
  file when another is opened`.
- **Renaming the open file while a save is waiting** must send the save to the
  old path first, then rename, with nothing lost → Task 3 test `flushes before a
  rename`.
- **Undoing back to the saved text** must not send a save, and must clear the
  title's "•" → Task 1 test `sends nothing when the content equals the last
  save`.

---

### Task 1: The save queue

**Files:**

- Create: `libs/web/core/src/core/saving/file-saver.ts` (+ `.spec.ts`),
  `libs/web/core/src/core/saving/save-status.model.ts`
- Modify: `libs/web/core/src/index.ts`

**Interfaces:**

- Produces:
  - `type SaveStatus = { kind: 'saved' } | { kind: 'saving' } | { kind:
    'offline' } | { kind: 'refused'; code: string }`.
  - `interface SaveResult { hash: string }`.
  - `class FileSaver` — `constructor(options: { send: (content: string) =>
    Promise<SaveResult>; lastSaved: string; delayMs?: number; retryDelaysMs?:
    readonly number[] })`; `edit(content: () => string): void` (reads the
    content only when it sends); `flush(): Promise<void>` (sends a waiting save
    at once and resolves when nothing is waiting or in flight); `discard():
    void`; `status: Signal<SaveStatus>`; `unsaved: Signal<boolean>`;
    `lastSaved(): { content: string; hash: string | null }`; `saved:
    Observable<SaveResult>` (each confirmed save). An error with an `ApiError`
    of status `4xx` is `refused` with its code; anything else is `offline`.
  - After a refusal, the next `edit` tries again (ED-19: "saving resumes when
    the content is small enough").

- [ ] **Step 1: Write the failing tests** (fake timers): `AC-EDIT-001.3: sends
      1.5 s after the last edit`; `sends only the newest content after the save
      in flight`; `sends nothing when the content equals the last save`;
      `AC-EDIT-001.5: retries until the backend answers` (statuses `saving` →
      `offline` → `saved`); `does not retry a refusal and tries again after the
      next edit`; `flush sends at once and waits`; `discard drops the waiting
      save`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-core`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(core): add the save queue`

---

### Task 2: Opening files in the editor

**Files:**

- Create (generated service):
  `libs/web/feature-repository-screen/src/repository-screen/services/open-files`
  (+ `.spec.ts`)
- Create (generated components): `components/editor-pane`,
  `components/large-file-note` (each + `.spec.ts`)
- Modify: `components/editor-area/*`, `components/entry-message/*`,
  `libs/ui/src/index.ts`, `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `FilesApi.readFile`, `.saveFile` (plan 23); `FileSaver` (Task 1);
  `createEditorState`, `setHighlighting`, `contentOf`, `CodeEditorComponent`
  (plan 24); `injectNarrowViewport`.
- Produces:
  - `interface OpenFile { path: string; file: FileContent; hash:
    WritableSignal<string>; editorState: unknown; saver: FileSaver; highlight:
    WritableSignal<boolean>; largeOnNarrow: boolean }` — `editorState` is the
    pane's `EditorState`, opaque to the store so that the store needs no
    CodeMirror code.
  - `OpenFiles` (provided by the page): `open(path: string): Promise<OpenFile>`
    (reuses an entry kept from earlier in the tab, ED-8), `get(path)`, `current:
    Signal<OpenFile | null>`, `flushAll(): Promise<void>`, `rekey(from: string,
    to: string)` (also for every path under a renamed folder), `close(path:
    string, options: { dropPending: boolean })`, `anyUnsaved: Signal<boolean>`.
    The saver sends `saveFile({ path, content, lineEnding, bom })` and updates
    `hash`.
  - `EditorPaneComponent` — `ce-code-editor` with the open file's state, the
    large-file note, the **Find** button (ED-11); writes each `stateChange` back
    into the `OpenFile` and calls `saver.edit` on document changes.
  - `EditorAreaComponent` shows a loading state while a file opens (ED-5), the
    pane inside `@defer`, and the open-time messages in the message panel.

- [ ] **Step 1: Write the failing tests**: `AC-EDIT-001.1: opens a Markdown file
      in the editor` (highlighted); `AC-FILE-001.10: shows the too-large and
      not-UTF-8 messages instead of the editor`; `keeps a file's editor state
      when another file is opened and back`; `AC-EDIT-001.25: opens a large file
      without highlighting on a narrow screen` (note shown; the button turns it
      on and hides the note; opening another file and then this one again shows
      the note again with the undo history kept; not on a wide screen; a 50 KB
      file never); `labels the editor with the file name`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement**; export `injectNarrowViewport` from `ui`.
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test -p
      web-feature-repository-screen ui`.
- [ ] **Step 5: Commit** — `feat(repository-screen): open files in the editor`

---

### Task 3: Save status, flushing and the title

**Files:**

- Create (generated component): `components/save-status` (+ `.spec.ts`)
- Modify: `components/repository-bar/*`, `services/entry-commands/*` (+ spec),
  `pages/repository-screen/*`, `services/repository-session/*`,
  `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `OpenFiles` (Task 2).
- Produces:
  - `SaveStatusComponent` (input `status: SaveStatus | null`): the texts of
    Global Constraints in a polite live region.
  - Flushing as Global Constraints say: the page flushes on file change, on
    `visibilitychange` to hidden and in `ngOnDestroy`; `EntryCommands` awaits
    `flushAll()` before a rename and calls `rekey` after it, and calls `close(…,
    { dropPending: true })` after a delete.
  - The title gains "• " while `current().saver.unsaved()`.

- [ ] **Step 1: Write the failing tests**: `shows each status's text`;
      `announces the status politely`; `AC-EDIT-001.4: saves the first file when
      another is opened`; `flushes when the tab is hidden`; `flushes before a
      rename`; `drops the waiting save when the file is deleted`; `AC-APP-001.9:
      puts a dot in the title while an edit is unsaved`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): save edits`

---

### Task 4: End-to-end tests, size and status

**Files:**

- Create: `apps/web-e2e/src/editor.spec.ts`
- Modify: `docs/architecture/web-client.md` (A-8.11: the editor chunk's measured
  size), `docs/product/mvp.md`

- [ ] **Step 1: Write the tests**: `AC-EDIT-001.3: saves after typing stops
      without committing` (the file on disk through the API, `git log`
      unchanged); `AC-EDIT-001.4`; `AC-EDIT-001.5: saves after the network comes
      back` (`context.setOffline`); `AC-EDIT-001.10: shows the 1 MB refusal and
      saves again once smaller`; `AC-EDIT-001.2: is ready to edit a 100 KB file
      within NF-2.2` (desktop, and slow 4G throttling through CDP: editor usable
      within 2 s); `AC-EDIT-001.22: opens find and replace from the button and
      Ctrl+F, and Esc then Tab leaves the editor`; `AC-EDIT-001.25` on a phone
      and a desktop viewport; `AC-FILE-001.10`; `AC-FILE-001.17: keeps an edit
      typed just before renaming the open file`; `AC-APP-001.6: saves an edit
      typed just before switching repositories`; `AC-APP-001.9`; `has no axe
      violations` with a file open.
- [ ] **Step 2: Run them** — `npx nx e2e web-e2e`; all pass in the NF-12.2
      matrix.
- [ ] **Step 3: Record the size**: `npx nx build web` and read the code-editor
      chunk's gzipped size from the build stats; write it into A-8.11 with the
      date; the initial bundle stays within NF-2.9.
- [ ] **Step 4: Update the status**: REQ-EDIT-001 adds ED-1 to ED-5, ED-8 to
      ED-19 (ED-19's `entry-not-found` case comes with plan 27), ED-9a, ED-37,
      ED-38's save status; Built in adds `editing-saving`; REQ-FILE-001
      completes FB-21 and FB-36; REQ-APP-001 adds NV-12 and NV-13. Run
      `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 5: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; commit `test(editor): cover
      editing and saving`.
